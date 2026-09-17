/*
 * DesktopBounties - Vencord userplugin
 * Shows Discord's mobile Quest Home Bounties on desktop.
 */

import "./styles.css";

import { ApplicationCommandInputType } from "@api/Commands";
import definePlugin from "@utils/types";
import { Modal, openModal, React, RestAPI } from "@webpack/common";

const QUEST_HOME_MOBILE_CAROUSEL_PLACEMENT = 4;
const BOUNTY_CREATIVE_TYPE = 3;
const MAX_DECISIONS = 15;

const AD_SESSION_STORAGE_KEY = "vc-desktop-bounties-ad-session-v1";
const PROGRESS_STORAGE_KEY = "vc-desktop-bounties-progress-v1";
const CLAIMED_STORAGE_KEY = "vc-desktop-bounties-claimed-v1";
const SIDEBAR_DATA_ATTRIBUTE = "vcDesktopBountiesNav";

const AD_SESSION_IDLE_MS = 30 * 60 * 1000;
const AD_SESSION_MAX_MS = 12 * 60 * 60 * 1000;

interface BountyCTA {
    url?: string;
    button_label?: string;
}

interface BountyCreativeContent {
    id: string;
    advertiser_name?: string;
    product_name?: string;
    product_icon?: string;
    video_preview?: string;
    image_preview?: string;
    video_hls?: string;
    cta?: BountyCTA;
    reward_timer_seconds?: number;
    video_duration_seconds?: number;
}

interface BountyCreative {
    type?: number;
    creative_type?: number;
    creative_content?: BountyCreativeContent;
    starts_at?: string;
    ends_at?: string;
}

interface AdDecision {
    creative?: BountyCreative | null;
    ad_identifiers?: {
        creative_type?: number;
        creative_id?: string;
        ad_content_id?: string;
        [key: string]: unknown;
    } | null;
    metadata_sealed?: string;
    traffic_metadata_sealed?: string;
    [key: string]: unknown;
}

interface DecisionsResponse {
    request_id?: string;
    decisions?: AdDecision[];
}

interface LoadResult {
    requestId?: string;
    decisions: AdDecision[];
    bounties: AdDecision[];
    clientAdSessionId: string;
}

interface StoredAdSession {
    id: string;
    createdAt: number;
    lastUsedAt: number;
}

type ClaimState = "idle" | "claiming" | "claimed" | "error";

let sidebarObserver: MutationObserver | null = null;
let sidebarFrame = 0;

function createUuid(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }

    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

function getAdSessionId(): string {
    const now = Date.now();

    try {
        const raw = localStorage.getItem(AD_SESSION_STORAGE_KEY);
        if (raw) {
            const stored = JSON.parse(raw) as StoredAdSession;
            const idleFor = now - stored.lastUsedAt;
            const age = now - stored.createdAt;

            if (stored.id && idleFor < AD_SESSION_IDLE_MS && age < AD_SESSION_MAX_MS) {
                localStorage.setItem(AD_SESSION_STORAGE_KEY, JSON.stringify({
                    ...stored,
                    lastUsedAt: now
                }));
                return stored.id;
            }
        }
    } catch {
        // Ignore malformed/blocked storage and create a fresh session below.
    }

    const fresh: StoredAdSession = {
        id: createUuid(),
        createdAt: now,
        lastUsedAt: now
    };

    try {
        localStorage.setItem(AD_SESSION_STORAGE_KEY, JSON.stringify(fresh));
    } catch {
        // Storage is optional; the in-flight request can still use this ID.
    }

    return fresh.id;
}

function readProgress(): Record<string, number> {
    try {
        return JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY) ?? "{}") as Record<string, number>;
    } catch {
        return {};
    }
}

function getSavedProgress(id: string): number {
    return Math.max(0, Number(readProgress()[id]) || 0);
}

function saveProgress(id: string, seconds: number) {
    try {
        const all = readProgress();
        all[id] = Math.max(0, seconds);
        localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(all));
    } catch {
        // Progress persistence is a convenience, not required for watching.
    }
}

function readClaimedIds(): Set<string> {
    try {
        const ids = JSON.parse(localStorage.getItem(CLAIMED_STORAGE_KEY) ?? "[]") as string[];
        return new Set(Array.isArray(ids) ? ids : []);
    } catch {
        return new Set();
    }
}

function isLocallyClaimed(id: string): boolean {
    return readClaimedIds().has(id);
}

function rememberClaimed(id: string) {
    try {
        const ids = readClaimedIds();
        ids.add(id);
        localStorage.setItem(CLAIMED_STORAGE_KEY, JSON.stringify([...ids]));
    } catch {
        // The successful server response is authoritative; local state is optional.
    }
}

function mediaUrl(asset?: string): string | undefined {
    if (!asset) return undefined;
    if (/^(?:https?:|blob:|data:)/i.test(asset)) return asset;

    return `https://cdn.discordapp.com/${asset.replace(/^\/+/, "")}`;
}

function safeExternalUrl(value?: string): string | undefined {
    if (!value) return undefined;

    try {
        const parsed = new URL(value);
        return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : undefined;
    } catch {
        return undefined;
    }
}

function openExternal(value?: string) {
    const url = safeExternalUrl(value);
    if (!url) return;

    if (typeof VencordNative !== "undefined") {
        VencordNative.native.openExternal(url);
        return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;

    if (error && typeof error === "object") {
        const maybeError = error as {
            body?: { message?: string; code?: number; };
            message?: string;
            status?: number;
        };
        if (maybeError.body?.message) {
            const code = maybeError.body.code != null ? ` (${maybeError.body.code})` : "";
            return `${maybeError.body.message}${code}`;
        }
        if (maybeError.message) return maybeError.message;
        if (maybeError.status != null) return `HTTP ${maybeError.status}`;
    }

    return String(error);
}

function getCreativeType(decision: AdDecision): number | undefined {
    return decision.creative?.creative_type
        ?? decision.creative?.type
        ?? decision.ad_identifiers?.creative_type;
}

function getBountyContent(decision: AdDecision): BountyCreativeContent | undefined {
    return decision.creative?.creative_content;
}

async function fetchBounties(): Promise<LoadResult> {
    const clientAdSessionId = getAdSessionId();
    const response = await RestAPI.get({
        url: "/quests/get-decisions",
        query: {
            placement: QUEST_HOME_MOBILE_CAROUSEL_PLACEMENT,
            num_decisions_requested: MAX_DECISIONS,
            client_ad_session_id: clientAdSessionId
        }
    });

    const body = (response?.body ?? {}) as DecisionsResponse;
    const decisions = Array.isArray(body.decisions) ? body.decisions : [];
    const bounties = decisions.filter(decision =>
        getCreativeType(decision) === BOUNTY_CREATIVE_TYPE && getBountyContent(decision) != null
    );

    return {
        requestId: body.request_id,
        decisions,
        bounties,
        clientAdSessionId
    };
}

async function claimBounty(decision: AdDecision, clientAdSessionId: string) {
    const content = getBountyContent(decision);
    if (!content?.id) throw new Error("Missing Bounty creative ID");

    const body: Record<string, string> = {
        client_ad_session_id: clientAdSessionId
    };

    if (decision.metadata_sealed) {
        body.decision_metadata_sealed = decision.metadata_sealed;
    }

    if (decision.traffic_metadata_sealed) {
        body.traffic_metadata_sealed = decision.traffic_metadata_sealed;
    }

    await RestAPI.post({
        url: `/quests/creatives/${content.id}/claim-reward`,
        body
    });
}

function BountyCard({
    decision,
    clientAdSessionId
}: {
    decision: AdDecision;
    clientAdSessionId: string;
}) {
    const content = getBountyContent(decision);
    if (!content) return null;

    const image = mediaUrl(content.image_preview ?? content.product_icon);
    const video = mediaUrl(content.video_preview ?? content.video_hls);
    const icon = mediaUrl(content.product_icon);
    const ctaUrl = safeExternalUrl(content.cta?.url);
    const targetSeconds = Math.max(1, content.reward_timer_seconds ?? 15);

    const [watchedSeconds, setWatchedSeconds] = React.useState(() =>
        Math.min(targetSeconds, getSavedProgress(content.id))
    );
    const [claimState, setClaimState] = React.useState<ClaimState>(() =>
        isLocallyClaimed(content.id) ? "claimed" : "idle"
    );
    const [claimError, setClaimError] = React.useState<string | null>(null);
    const [videoFailed, setVideoFailed] = React.useState(false);

    const isPlayingRef = React.useRef(false);
    const lastTickRef = React.useRef<number | null>(null);
    const wholeSeconds = Math.floor(watchedSeconds);
    const progressPercent = claimState === "claimed"
        ? 100
        : Math.min(100, Math.round((watchedSeconds / targetSeconds) * 100));

    const doClaim = React.useCallback(async () => {
        if (claimState === "claiming" || claimState === "claimed") return;

        setClaimState("claiming");
        setClaimError(null);

        try {
            await claimBounty(decision, clientAdSessionId);
            rememberClaimed(content.id);
            setClaimState("claimed");
        } catch (error) {
            console.error("[DesktopBounties] Discord rejected Bounty claim", error);
            setClaimError(getErrorMessage(error));
            setClaimState("error");
        }
    }, [claimState, decision, clientAdSessionId, content.id]);

    React.useEffect(() => {
        saveProgress(content.id, wholeSeconds);
    }, [content.id, wholeSeconds]);

    React.useEffect(() => {
        const interval = window.setInterval(() => {
            const now = performance.now();

            if (
                !isPlayingRef.current
                || document.visibilityState !== "visible"
                || claimState === "claimed"
                || claimState === "claiming"
            ) {
                lastTickRef.current = now;
                return;
            }

            const previous = lastTickRef.current ?? now;
            lastTickRef.current = now;
            const deltaSeconds = Math.min(0.75, Math.max(0, (now - previous) / 1000));

            if (deltaSeconds > 0) {
                setWatchedSeconds(current => Math.min(targetSeconds, current + deltaSeconds));
            }
        }, 250);

        return () => window.clearInterval(interval);
    }, [targetSeconds, claimState]);

    React.useEffect(() => {
        if (watchedSeconds >= targetSeconds && claimState === "idle") {
            void doClaim();
        }
    }, [watchedSeconds, targetSeconds, claimState, doClaim]);

    const statusText = (() => {
        if (claimState === "claimed") return "Completed — Discord accepted the reward claim";
        if (claimState === "claiming") return "Completed — sending claim to Discord…";
        if (claimState === "error") return "Watch complete — Discord did not accept the claim";
        if (watchedSeconds >= targetSeconds) return "Watch complete — ready to claim";
        if (isPlayingRef.current) return `${wholeSeconds}s / ${targetSeconds}s watched`;
        return `${wholeSeconds}s / ${targetSeconds}s — play the video to continue`;
    })();

    return (
        <article className="vc-desktop-bounties-card">
            <div className="vc-desktop-bounties-media">
                {video && !videoFailed ? (
                    <video
                        src={video}
                        poster={image}
                        muted
                        loop
                        playsInline
                        controls
                        preload="metadata"
                        onPlay={() => {
                            isPlayingRef.current = true;
                            lastTickRef.current = performance.now();
                        }}
                        onPause={() => {
                            isPlayingRef.current = false;
                            lastTickRef.current = null;
                        }}
                        onEnded={() => {
                            isPlayingRef.current = false;
                            lastTickRef.current = null;
                        }}
                        onError={() => {
                            isPlayingRef.current = false;
                            setVideoFailed(true);
                        }}
                    />
                ) : image ? (
                    <img src={image} alt="" />
                ) : (
                    <div className="vc-desktop-bounties-mediaFallback">Bounty</div>
                )}
            </div>

            <div className="vc-desktop-bounties-body">
                <div className="vc-desktop-bounties-titleRow">
                    {icon && <img className="vc-desktop-bounties-icon" src={icon} alt="" />}
                    <div className="vc-desktop-bounties-titleText">
                        <strong>{content.product_name || content.advertiser_name || "Bounty"}</strong>
                        {content.advertiser_name && content.product_name && (
                            <span>{content.advertiser_name}</span>
                        )}
                    </div>
                </div>

                <div className="vc-desktop-bounties-progressText">
                    <span>{statusText}</span>
                    <strong>{progressPercent}%</strong>
                </div>

                <div
                    className="vc-desktop-bounties-progress"
                    role="progressbar"
                    aria-label={`Bounty watch progress for ${content.product_name || content.advertiser_name || content.id}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progressPercent}
                >
                    <div style={{ width: `${progressPercent}%` }} />
                </div>

                {claimError && (
                    <div className="vc-desktop-bounties-claimError">
                        Discord response: {claimError}
                    </div>
                )}

                <div className="vc-desktop-bounties-meta">
                    <span>Creative: {content.id}</span>
                    <span>Required watch: {targetSeconds}s</span>
                </div>

                <div className="vc-desktop-bounties-actions">
                    {claimState === "error" && watchedSeconds >= targetSeconds && (
                        <button
                            className="vc-desktop-bounties-cta"
                            onClick={() => void doClaim()}
                        >
                            Retry claim
                        </button>
                    )}

                    <button
                        className="vc-desktop-bounties-secondaryButton"
                        disabled={!ctaUrl}
                        onClick={() => openExternal(ctaUrl)}
                    >
                        {content.cta?.button_label || "Open advertiser"}
                    </button>
                </div>
            </div>
        </article>
    );
}

function BountiesModal(props: any) {
    const [result, setResult] = React.useState<LoadResult | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    const load = React.useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            setResult(await fetchBounties());
        } catch (err) {
            console.error("[DesktopBounties] Failed to fetch mobile Bounties", err);
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        void load();
    }, [load]);

    const creativeTypes = React.useMemo(() => {
        if (!result) return "";

        const counts = new Map<number | string, number>();
        for (const decision of result.decisions) {
            const type = getCreativeType(decision) ?? "unknown";
            counts.set(type, (counts.get(type) ?? 0) + 1);
        }

        return [...counts.entries()].map(([type, count]) => `${type}:${count}`).join(" · ");
    }, [result]);

    return (
        <Modal
            {...props}
            title="Bounties"
            size="xl"
            actions={[
                {
                    text: loading ? "Loading…" : "Refresh",
                    variant: "primary",
                    disabled: loading,
                    onClick: () => void load()
                },
                {
                    text: "Close",
                    variant: "secondary",
                    onClick: props.onClose
                }
            ]}
        >
            <div className="vc-desktop-bounties-root">
                <div className="vc-desktop-bounties-intro">
                    Bounties returned by Discord for the mobile Quest Home placement. Watch progress only advances while the video is actually playing in a visible Discord window. When the required watch time is reached, the plugin sends Discord's creative reward claim request.
                </div>

                {loading && !result && (
                    <div className="vc-desktop-bounties-state">Loading Bounties…</div>
                )}

                {error && (
                    <div className="vc-desktop-bounties-state vc-desktop-bounties-error">
                        Request failed: {error}
                    </div>
                )}

                {!loading && !error && result?.bounties.length === 0 && (
                    <div className="vc-desktop-bounties-state">
                        Discord returned no Bounty creatives for this account on the mobile Quest Home placement.
                    </div>
                )}

                {!!result?.bounties.length && (
                    <div className="vc-desktop-bounties-grid">
                        {result.bounties.map((decision, index) => (
                            <BountyCard
                                key={getBountyContent(decision)?.id ?? index}
                                decision={decision}
                                clientAdSessionId={result.clientAdSessionId}
                            />
                        ))}
                    </div>
                )}

                {result && (
                    <div className="vc-desktop-bounties-debug">
                        <span>Decisions: {result.decisions.length}</span>
                        <span>Bounties: {result.bounties.length}</span>
                        {creativeTypes && <span>Creative types: {creativeTypes}</span>}
                        {result.requestId && <span>Request: {result.requestId}</span>}
                    </div>
                )}
            </div>
        </Modal>
    );
}

export function openBountiesModal() {
    openModal(props => <BountiesModal {...props} />);
}

function findQuestHomeLink(): HTMLAnchorElement | null {
    const links = [...document.querySelectorAll<HTMLAnchorElement>('a[href*="quest-home"]')];

    return links.find(link => {
        try {
            return new URL(link.href, location.href).pathname === "/quest-home"
                && link.getClientRects().length > 0;
        } catch {
            return false;
        }
    }) ?? null;
}

function installSidebarEntry() {
    const questLink = findQuestHomeLink();
    if (!questLink) return;

    const questItem = questLink.closest("li") ?? questLink.parentElement;
    const parent = questItem?.parentElement;
    if (!questItem || !parent) return;

    if (parent.querySelector(`[data-${SIDEBAR_DATA_ATTRIBUTE.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)}]`)) {
        return;
    }

    const shell = document.createElement(questItem.tagName.toLowerCase() === "li" ? "li" : "div");
    shell.dataset[SIDEBAR_DATA_ATTRIBUTE] = "true";
    shell.className = "vc-desktop-bounties-navShell";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "vc-desktop-bounties-navButton";
    button.setAttribute("aria-label", "Bounties");
    button.innerHTML = `
        <svg class="vc-desktop-bounties-navIcon" aria-hidden="true" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="6.25" stroke="currentColor" stroke-width="2" />
            <circle cx="12" cy="12" r="2.25" fill="currentColor" />
            <path d="M12 2.5V5M12 19V21.5M2.5 12H5M19 12H21.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
        <span>Bounties</span>
    `;
    button.addEventListener("click", openBountiesModal);

    shell.appendChild(button);
    questItem.insertAdjacentElement("afterend", shell);
}

function scheduleSidebarEntry() {
    if (sidebarFrame) return;

    sidebarFrame = requestAnimationFrame(() => {
        sidebarFrame = 0;
        installSidebarEntry();
    });
}

function startSidebarEntry() {
    stopSidebarEntry();
    installSidebarEntry();

    if (!document.body) return;

    sidebarObserver = new MutationObserver(scheduleSidebarEntry);
    sidebarObserver.observe(document.body, {
        childList: true,
        subtree: true
    });
}

function stopSidebarEntry() {
    sidebarObserver?.disconnect();
    sidebarObserver = null;

    if (sidebarFrame) {
        cancelAnimationFrame(sidebarFrame);
        sidebarFrame = 0;
    }

    document.querySelectorAll<HTMLElement>("[data-vc-desktop-bounties-nav]").forEach(node => node.remove());
}

export default definePlugin({
    name: "DesktopBounties",
    description: "Adds mobile Quest Bounties to Discord desktop with real watch progress and reward claiming.",
    authors: [{
        name: "danyx64",
        id: 1533113566075424881n
    }],

    start() {
        startSidebarEntry();
    },

    stop() {
        stopSidebarEntry();
    },

    commands: [{
        name: "bounties",
        description: "Open the Desktop Bounties viewer",
        inputType: ApplicationCommandInputType.BUILT_IN,
        execute() {
            openBountiesModal();
        }
    }]
});
