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
    creative_type?: number;
    creative_content?: BountyCreativeContent;
    starts_at?: string;
    ends_at?: string;
}

interface AdDecision {
    creative?: BountyCreative | null;
    ad_identifiers?: {
        creative_type?: number;
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
}

function mediaUrl(asset?: string): string | undefined {
    if (!asset) return undefined;
    if (/^(?:https?:|blob:|data:)/i.test(asset)) return asset;

    // Discord's client resolves relative Quest assets against the CDN root.
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

async function fetchBounties(): Promise<LoadResult> {
    const response = await RestAPI.get({
        url: "/quests/get-decisions",
        query: {
            placement: QUEST_HOME_MOBILE_CAROUSEL_PLACEMENT,
            num_decisions_requested: MAX_DECISIONS
        }
    });

    const body = (response?.body ?? {}) as DecisionsResponse;
    const decisions = Array.isArray(body.decisions) ? body.decisions : [];
    const bounties = decisions.filter(decision => {
        const type = decision.creative?.creative_type ?? decision.ad_identifiers?.creative_type;
        return type === BOUNTY_CREATIVE_TYPE && decision.creative?.creative_content != null;
    });

    return {
        requestId: body.request_id,
        decisions,
        bounties
    };
}

function BountyCard({ decision }: { decision: AdDecision; }) {
    const content = decision.creative?.creative_content;
    if (!content) return null;

    const image = mediaUrl(content.image_preview ?? content.product_icon);
    const video = mediaUrl(content.video_preview);
    const icon = mediaUrl(content.product_icon);
    const ctaUrl = safeExternalUrl(content.cta?.url);
    const timer = content.reward_timer_seconds ?? 15;

    return (
        <article className="vc-desktop-bounties-card">
            <div className="vc-desktop-bounties-media">
                {video ? (
                    <video
                        src={video}
                        poster={image}
                        muted
                        loop
                        playsInline
                        controls
                        preload="metadata"
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

                <div className="vc-desktop-bounties-meta">
                    <span>Creative: {content.id}</span>
                    <span>Reward timer: {timer}s</span>
                </div>

                <button
                    className="vc-desktop-bounties-cta"
                    disabled={!ctaUrl}
                    onClick={() => openExternal(ctaUrl)}
                >
                    {content.cta?.button_label || "Open"}
                </button>
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
            console.error("[DesktopBounties] Failed to fetch mobile bounties", err);
            setError(err instanceof Error ? err.message : String(err));
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
            const type = decision.creative?.creative_type ?? decision.ad_identifiers?.creative_type ?? "unknown";
            counts.set(type, (counts.get(type) ?? 0) + 1);
        }

        return [...counts.entries()].map(([type, count]) => `${type}:${count}`).join(" · ");
    }, [result]);

    return (
        <Modal
            {...props}
            title="Desktop Bounties"
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
                    Reads Discord's mobile Quest Home placement (4) from the authenticated desktop client.
                    It does not spoof account eligibility, region or targeting.
                </div>

                {loading && !result && (
                    <div className="vc-desktop-bounties-state">Loading mobile Bounties…</div>
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
                                key={decision.creative?.creative_content?.id ?? index}
                                decision={decision}
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

export default definePlugin({
    name: "DesktopBounties",
    description: "Displays Discord mobile Quest Bounties on desktop.",
    authors: [{
        name: "danyx64",
        id: 1533113566075424881n
    }],

    commands: [{
        name: "bounties",
        description: "Open the Desktop Bounties viewer",
        inputType: ApplicationCommandInputType.BUILT_IN,
        execute() {
            openBountiesModal();
        }
    }]
});
