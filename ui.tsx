/*
 * DesktopBounties UI
 */

import { NavigationRouter, React } from "@webpack/common";

import {
    AdDecision,
    claimBounty,
    fetchBounties,
    fetchOrbBalance,
    getAdSessionId,
    getBountyContent,
    getCreativeType,
    getErrorMessage,
    getSavedProgress,
    isBountiesRoute,
    isLocallyClaimed,
    LoadResult,
    mediaUrl,
    openBountiesPage,
    openExternal,
    readClaimedSnapshots,
    rememberClaimed,
    safeExternalUrl,
    saveProgress,
    snapshotToDecision
} from "./core";

type ClaimState = "idle" | "claiming" | "claimed" | "error";

function BountyIcon({ className = "" }: { className?: string; }) {
    return (
        <svg className={className} aria-hidden="true" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="6.25" stroke="currentColor" strokeWidth="2" />
            <circle cx="12" cy="12" r="2.25" fill="currentColor" />
            <path
                d="M12 2.5V5M12 19V21.5M2.5 12H5M19 12H21.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
            />
        </svg>
    );
}

function OrbIcon() {
    return (
        <svg className="vc-desktop-bounties-orbIcon" aria-hidden="true" viewBox="0 0 24 24">
            <path fill="currentColor" d="M12 2.25 14.32 7l5.18.75-3.75 3.66.89 5.16L12 14.13l-4.64 2.44.89-5.16L4.5 7.75 9.68 7 12 2.25Z" />
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" opacity=".45" />
        </svg>
    );
}

function CheckIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24">
            <path fill="currentColor" d="m9.3 16.7-4-4a1 1 0 0 1 1.4-1.4l3.3 3.29 7.3-7.3a1 1 0 1 1 1.4 1.42l-8 8a1 1 0 0 1-1.4 0Z" />
        </svg>
    );
}

function formatClaimedAt(value?: number): string | null {
    if (!value || !Number.isFinite(value)) return null;

    try {
        return new Date(value).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric"
        });
    } catch {
        return null;
    }
}

export function BountiesNavItem() {
    const [active, setActive] = React.useState(isBountiesRoute);

    React.useEffect(() => {
        const interval = window.setInterval(() => {
            setActive(current => {
                const next = isBountiesRoute();
                return current === next ? current : next;
            });
        }, 250);

        return () => window.clearInterval(interval);
    }, []);

    return (
        <li className="vc-desktop-bounties-navShell" data-vc-desktop-bounties-nav="true">
            <button
                type="button"
                className={`vc-desktop-bounties-navButton${active ? " vc-desktop-bounties-navButton--active" : ""}`}
                aria-label="Bounties"
                aria-current={active ? "page" : undefined}
                onClick={openBountiesPage}
            >
                <BountyIcon className="vc-desktop-bounties-navIcon" />
                <span className="vc-desktop-bounties-navLabel">Bounties</span>
            </button>
        </li>
    );
}

function BountyCard({
    decision,
    clientAdSessionId,
    claimedAt,
    onBecameInProgress,
    onClaimed
}: {
    decision: AdDecision;
    clientAdSessionId: string;
    claimedAt?: number;
    onBecameInProgress: () => void;
    onClaimed: () => void;
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
    const [isPlaying, setIsPlaying] = React.useState(false);

    const isPlayingRef = React.useRef(false);
    const lastTickRef = React.useRef<number | null>(null);
    const notifiedProgressRef = React.useRef(getSavedProgress(content.id) > 0);
    const wholeSeconds = Math.floor(watchedSeconds);
    const completed = claimState === "claimed";
    const started = wholeSeconds > 0 && !completed;
    const progressPercent = completed
        ? 100
        : Math.min(100, Math.round((watchedSeconds / targetSeconds) * 100));
    const claimedDate = formatClaimedAt(claimedAt);

    const doClaim = React.useCallback(async () => {
        if (claimState === "claiming" || claimState === "claimed") return;

        setClaimState("claiming");
        setClaimError(null);

        try {
            await claimBounty(decision, clientAdSessionId);
            rememberClaimed(content);
            setClaimState("claimed");
            setWatchedSeconds(targetSeconds);
            onClaimed();
        } catch (error) {
            console.error("[DesktopBounties] Discord rejected Bounty claim", error);
            setClaimError(getErrorMessage(error));
            setClaimState("error");
        }
    }, [claimState, decision, clientAdSessionId, content, targetSeconds, onClaimed]);

    React.useEffect(() => {
        saveProgress(content.id, wholeSeconds);

        if (wholeSeconds > 0 && !notifiedProgressRef.current && !completed) {
            notifiedProgressRef.current = true;
            onBecameInProgress();
        }
    }, [content.id, wholeSeconds, completed, onBecameInProgress]);

    React.useEffect(() => {
        const interval = window.setInterval(() => {
            const now = performance.now();

            if (
                !isPlayingRef.current
                || document.visibilityState !== "visible"
                || !document.hasFocus()
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
        if (claimState === "claimed") return claimedDate ? `Completed ${claimedDate}` : "Completed and claimed on Discord";
        if (claimState === "claiming") return "Watch complete — claiming reward…";
        if (claimState === "error") return "Watch complete — claim needs retry";
        if (watchedSeconds >= targetSeconds) return "Watch complete — ready to claim";
        if (isPlaying) return `${wholeSeconds}s of ${targetSeconds}s watched`;
        if (wholeSeconds > 0) return `${wholeSeconds}s of ${targetSeconds}s — resume video`;
        return `Watch ${targetSeconds}s to complete`;
    })();

    return (
        <article className={`vc-desktop-bounties-card${completed ? " vc-desktop-bounties-card--completed" : ""}`}>
            <div className="vc-desktop-bounties-media">
                {video && !videoFailed && !completed ? (
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
                            setIsPlaying(true);
                            lastTickRef.current = performance.now();
                        }}
                        onPause={() => {
                            isPlayingRef.current = false;
                            setIsPlaying(false);
                            lastTickRef.current = null;
                        }}
                        onEnded={() => {
                            isPlayingRef.current = false;
                            setIsPlaying(false);
                            lastTickRef.current = null;
                        }}
                        onError={() => {
                            isPlayingRef.current = false;
                            setIsPlaying(false);
                            setVideoFailed(true);
                        }}
                    />
                ) : image ? (
                    <img src={image} alt="" />
                ) : (
                    <div className="vc-desktop-bounties-mediaFallback">
                        <BountyIcon />
                    </div>
                )}

                <span className={`vc-desktop-bounties-statusPill${completed ? " vc-desktop-bounties-statusPill--completed" : started ? " vc-desktop-bounties-statusPill--progress" : ""}`}>
                    {completed && <CheckIcon />}
                    {completed ? "Completed" : started ? "In progress" : "Available"}
                </span>

                {completed && (
                    <div className="vc-desktop-bounties-completedOverlay">
                        <span className="vc-desktop-bounties-completedCheck"><CheckIcon /></span>
                        <span>Completed</span>
                    </div>
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
                    <span className={completed ? "vc-desktop-bounties-successText" : ""}>{statusText}</span>
                    <strong>{progressPercent}%</strong>
                </div>

                <div
                    className={`vc-desktop-bounties-progress${completed ? " vc-desktop-bounties-progress--completed" : ""}`}
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
                        <strong>Discord did not accept the claim.</strong>
                        <span>{claimError}</span>
                    </div>
                )}

                <div className="vc-desktop-bounties-cardFooter">
                    <span className="vc-desktop-bounties-requirement">
                        {completed ? "Reward claimed" : `${targetSeconds}s watch requirement`}
                    </span>

                    <div className="vc-desktop-bounties-actions">
                        {claimState === "error" && watchedSeconds >= targetSeconds && (
                            <button
                                className="vc-desktop-bounties-primaryButton"
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
                            {content.cta?.button_label || "Advertiser"}
                        </button>
                    </div>
                </div>
            </div>
        </article>
    );
}

function SectionHeader({
    title,
    description,
    count,
    completed = false
}: {
    title: string;
    description: string;
    count: number;
    completed?: boolean;
}) {
    return (
        <div className="vc-desktop-bounties-sectionHeader">
            <div>
                <div className="vc-desktop-bounties-sectionTitleRow">
                    {completed && <span className="vc-desktop-bounties-sectionCheck"><CheckIcon /></span>}
                    <h2>{title}</h2>
                    <span className="vc-desktop-bounties-sectionCount">{count}</span>
                </div>
                <p>{description}</p>
            </div>
        </div>
    );
}

function BountiesPage() {
    const [result, setResult] = React.useState<LoadResult | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const [orbBalance, setOrbBalance] = React.useState<number | null>(null);
    const [orbLoading, setOrbLoading] = React.useState(true);
    const [localVersion, setLocalVersion] = React.useState(0);

    const loadOrbBalance = React.useCallback(async () => {
        setOrbLoading(true);
        try {
            setOrbBalance(await fetchOrbBalance());
        } catch (err) {
            console.warn("[DesktopBounties] Failed to fetch Orb balance", err);
            setOrbBalance(null);
        } finally {
            setOrbLoading(false);
        }
    }, []);

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

        void loadOrbBalance();
    }, [loadOrbBalance]);

    React.useEffect(() => {
        void load();
    }, [load]);

    const claimedSnapshots = React.useMemo(() => readClaimedSnapshots(), [localVersion]);
    const claimedAtById = React.useMemo(() => {
        const map = new Map<string, number>();
        for (const snapshot of claimedSnapshots) map.set(snapshot.id, snapshot.claimedAt);
        return map;
    }, [claimedSnapshots]);

    const mergedBounties = React.useMemo(() => {
        const byId = new Map<string, AdDecision>();

        for (const decision of result?.bounties ?? []) {
            const id = getBountyContent(decision)?.id;
            if (id) byId.set(id, decision);
        }

        for (const snapshot of claimedSnapshots) {
            if (!byId.has(snapshot.id)) byId.set(snapshot.id, snapshotToDecision(snapshot));
        }

        return [...byId.values()];
    }, [result, claimedSnapshots]);

    const classified = React.useMemo(() => {
        const todo: AdDecision[] = [];
        const completed: AdDecision[] = [];

        for (const decision of mergedBounties) {
            const content = getBountyContent(decision);
            if (!content) continue;

            if (isLocallyClaimed(content.id)) completed.push(decision);
            else todo.push(decision);
        }

        todo.sort((a, b) => {
            const aId = getBountyContent(a)?.id ?? "";
            const bId = getBountyContent(b)?.id ?? "";
            return getSavedProgress(bId) - getSavedProgress(aId);
        });

        completed.sort((a, b) => {
            const aId = getBountyContent(a)?.id ?? "";
            const bId = getBountyContent(b)?.id ?? "";
            return (claimedAtById.get(bId) ?? 0) - (claimedAtById.get(aId) ?? 0);
        });

        return { todo, completed };
    }, [mergedBounties, claimedAtById, localVersion]);

    const inProgressCount = React.useMemo(
        () => classified.todo.filter(decision => {
            const id = getBountyContent(decision)?.id;
            return id ? getSavedProgress(id) > 0 : false;
        }).length,
        [classified.todo, localVersion]
    );

    const clientAdSessionId = result?.clientAdSessionId ?? getAdSessionId();
    const creativeTypes = React.useMemo(() => {
        if (!result) return "";
        const counts = new Map<number | string, number>();
        for (const decision of result.decisions) {
            const type = getCreativeType(decision) ?? "unknown";
            counts.set(type, (counts.get(type) ?? 0) + 1);
        }
        return [...counts.entries()].map(([type, count]) => `${type}:${count}`).join(" · ");
    }, [result]);

    const handleClaimed = React.useCallback(() => {
        setLocalVersion(version => version + 1);
        void loadOrbBalance();
    }, [loadOrbBalance]);

    const handleProgress = React.useCallback(() => {
        setLocalVersion(version => version + 1);
    }, []);

    return (
        <div className="vc-desktop-bounties-page">
            <div className="vc-desktop-bounties-pageInner">
                <header className="vc-desktop-bounties-pageHeader">
                    <div className="vc-desktop-bounties-headingGroup">
                        <div className="vc-desktop-bounties-headingIcon"><BountyIcon /></div>
                        <div className="vc-desktop-bounties-headingText">
                            <div className="vc-desktop-bounties-eyebrow">QUESTS</div>
                            <h1>Bounties</h1>
                            <p>Watch eligible sponsored videos and claim the reward directly with Discord.</p>
                            <div className="vc-desktop-bounties-summaryLine">
                                <span><strong>{classified.todo.length}</strong> to do</span>
                                <span><strong>{inProgressCount}</strong> in progress</span>
                                <span><strong>{classified.completed.length}</strong> completed</span>
                            </div>
                        </div>
                    </div>

                    <div className="vc-desktop-bounties-headerActions">
                        <button
                            type="button"
                            className="vc-desktop-bounties-refreshButton"
                            disabled={loading}
                            onClick={() => void load()}
                        >
                            {loading ? "Refreshing…" : "Refresh"}
                        </button>

                        <button
                            type="button"
                            className="vc-desktop-bounties-orbPill"
                            title="Open the Orbs shop"
                            onClick={() => NavigationRouter.transitionTo("/shop?tab=orbs")}
                        >
                            <OrbIcon />
                            <span className="vc-desktop-bounties-orbValue">{orbLoading ? "…" : orbBalance != null ? orbBalance.toLocaleString() : "—"}</span>
                            <span className="vc-desktop-bounties-orbLabel">Orbs</span>
                        </button>
                    </div>
                </header>

                {error && (
                    <div className="vc-desktop-bounties-state vc-desktop-bounties-error">
                        <strong>Discord request failed</strong>
                        <span>{error}</span>
                    </div>
                )}

                <section className="vc-desktop-bounties-section">
                    <SectionHeader
                        title="To do"
                        description="Available Bounties are shown here. Bounties you start watching stay at the top."
                        count={classified.todo.length}
                    />

                    {loading && !result ? (
                        <div className="vc-desktop-bounties-skeletonGrid" aria-label="Loading Bounties">
                            {Array.from({ length: 4 }).map((_, index) => (
                                <div className="vc-desktop-bounties-skeletonCard" key={index} />
                            ))}
                        </div>
                    ) : classified.todo.length > 0 ? (
                        <div className="vc-desktop-bounties-grid">
                            {classified.todo.map((decision, index) => {
                                const id = getBountyContent(decision)?.id;
                                return (
                                    <BountyCard
                                        key={id ?? index}
                                        decision={decision}
                                        clientAdSessionId={clientAdSessionId}
                                        claimedAt={id ? claimedAtById.get(id) : undefined}
                                        onBecameInProgress={handleProgress}
                                        onClaimed={handleClaimed}
                                    />
                                );
                            })}
                        </div>
                    ) : !error && (
                        <div className="vc-desktop-bounties-emptyState vc-desktop-bounties-emptyState--compact">
                            <div className="vc-desktop-bounties-emptyIcon"><BountyIcon /></div>
                            <div>
                                <h3>No Bounties to do</h3>
                                <p>Discord did not return any available Bounty creatives for this account right now.</p>
                            </div>
                        </div>
                    )}
                </section>

                <section className="vc-desktop-bounties-section vc-desktop-bounties-section--completed">
                    <SectionHeader
                        title="Completed"
                        description="Every Bounty successfully claimed by this plugin stays in this history."
                        count={classified.completed.length}
                        completed
                    />

                    {classified.completed.length > 0 ? (
                        <div className="vc-desktop-bounties-grid">
                            {classified.completed.map((decision, index) => {
                                const id = getBountyContent(decision)?.id;
                                return (
                                    <BountyCard
                                        key={id ?? index}
                                        decision={decision}
                                        clientAdSessionId={clientAdSessionId}
                                        claimedAt={id ? claimedAtById.get(id) : undefined}
                                        onBecameInProgress={handleProgress}
                                        onClaimed={handleClaimed}
                                    />
                                );
                            })}
                        </div>
                    ) : (
                        <div className="vc-desktop-bounties-emptyState vc-desktop-bounties-emptyState--compact">
                            <span className="vc-desktop-bounties-emptyCheck"><CheckIcon /></span>
                            <div>
                                <h3>No completed Bounties yet</h3>
                                <p>After Discord accepts a reward claim, the Bounty will be kept here.</p>
                            </div>
                        </div>
                    )}
                </section>

                {result && (
                    <details className="vc-desktop-bounties-debug">
                        <summary>Diagnostics</summary>
                        <div>
                            <span>Decisions: {result.decisions.length}</span>
                            <span>Live Bounties: {result.bounties.length}</span>
                            <span>Saved completed: {classified.completed.length}</span>
                            {creativeTypes && <span>Creative types: {creativeTypes}</span>}
                            {result.requestId && <span>Request: {result.requestId}</span>}
                        </div>
                    </details>
                )}
            </div>
        </div>
    );
}

export function renderBountiesPage() {
    return React.createElement(BountiesPage);
}
