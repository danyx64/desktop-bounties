/*
 * DesktopBounties UI
 */

import { filters, findComponentByCodeLazy, mapMangledModuleLazy } from "@webpack";
import { NavigationRouter, React, UserStore, useStateFromStores } from "@webpack/common";

import {
    AdDecision,
    BOUNTIES_ROUTE,
    claimBounty,
    fetchBounties,
    getBountyContent,
    getErrorMessage,
    getSavedProgress,
    isBountiesRoute,
    LoadResult,
    mediaUrl,
    openBountiesPage,
    openExternal,
    safeExternalUrl,
    saveProgress
} from "./core";

type ClaimState = "idle" | "claiming" | "error";

interface NativeNavClasses {
    wrapper: string;
    channel: string;
    interactive: string;
    interactiveSelected: string;
    link: string;
    layout: string;
    avatar: string;
    icon: string;
    content: string;
    nameAndDecorators: string;
    name: string;
}

const FALLBACK_NAV_CLASSES: NativeNavClasses = {
    wrapper: "wrapper__553bf",
    channel: "channel__972a0 container_e45859",
    interactive: "interactive_f88cfd interactive__972a0 linkButton__972a0",
    interactiveSelected: "interactive_f88cfd interactive__972a0 linkButton__972a0 interactiveSelected__972a0 selected_f88cfd",
    link: "link__972a0",
    layout: "layout__20a53 avatarWithText__972a0",
    avatar: "avatar__20a53",
    icon: "linkButtonIcon__972a0",
    content: "content__20a53",
    nameAndDecorators: "nameAndDecorators__20a53",
    name: "name__20a53 text-md/medium__20a53"
};

function topShortcutLink(name: "friends" | "nitro" | "shop" | "quests") {
    return document.querySelector<HTMLAnchorElement>(`a[data-list-item-id$="___${name}"]`);
}

function readNativeNavClasses(): NativeNavClasses {
    const questLink = topShortcutLink("quests");
    if (!questLink) return FALLBACK_NAV_CLASSES;

    const questInteractive = questLink.parentElement as HTMLElement | null;
    const questLi = questInteractive?.parentElement as HTMLElement | null;
    const questWrapper = questLi?.parentElement as HTMLElement | null;
    const layout = questLink.firstElementChild as HTMLElement | null;
    const avatar = layout?.firstElementChild as HTMLElement | null;
    const icon = avatar?.querySelector<SVGElement>("svg") ?? null;
    const content = layout?.children.item(1) as HTMLElement | null;
    const nameAndDecorators = content?.firstElementChild as HTMLElement | null;
    const name = nameAndDecorators?.firstElementChild as HTMLElement | null;

    const shopInteractive = topShortcutLink("shop")?.parentElement as HTMLElement | null;
    const interactive = shopInteractive?.className || questInteractive?.className || FALLBACK_NAV_CLASSES.interactive;

    const selectedInteractive = (["friends", "nitro", "shop", "quests"] as const)
        .map(topShortcutLink)
        .map(link => link?.parentElement as HTMLElement | null)
        .find(element => {
            const classes = element?.className;
            return typeof classes === "string"
                && (classes.includes("interactiveSelected") || /(^|\s)selected_/.test(classes));
        });

    return {
        wrapper: questWrapper?.className || FALLBACK_NAV_CLASSES.wrapper,
        channel: questLi?.className || FALLBACK_NAV_CLASSES.channel,
        interactive,
        interactiveSelected: selectedInteractive?.className || FALLBACK_NAV_CLASSES.interactiveSelected,
        link: questLink.className || FALLBACK_NAV_CLASSES.link,
        layout: layout?.className || FALLBACK_NAV_CLASSES.layout,
        avatar: avatar?.className || FALLBACK_NAV_CLASSES.avatar,
        icon: icon?.getAttribute("class") || FALLBACK_NAV_CLASSES.icon,
        content: content?.className || FALLBACK_NAV_CLASSES.content,
        nameAndDecorators: nameAndDecorators?.className || FALLBACK_NAV_CLASSES.nameAndDecorators,
        name: name?.className || FALLBACK_NAV_CLASSES.name
    };
}

function sameNativeNavClasses(a: NativeNavClasses, b: NativeNavClasses) {
    return Object.keys(a).every(key => a[key as keyof NativeNavClasses] === b[key as keyof NativeNavClasses]);
}

const HlsRuntime = mapMangledModuleLazy("ManagedMediaSource", {
    loadHls: filters.byCode(".then(", ".default"),
    canUseHls: filters.byCode("isTypeSupported")
}) as {
    loadHls: () => Promise<any>;
    canUseHls: () => boolean;
};

function BountyIcon({ className = "" }: { className?: string; }) {
    return (
        <svg className={className} aria-hidden="true" role="img" viewBox="0 0 24 24" fill="none">
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

const NativeOrbBalanceMenu = findComponentByCodeLazy<any>(
    "BalanceWidgetMenu",
    "showNotificationBadge",
    "balanceWidgetMode"
);

function FullBountyVideo({
    hlsUrl,
    poster,
    onAvailable,
    onUnavailable,
    onPlay,
    onPause,
    onEnded
}: {
    hlsUrl: string;
    poster?: string;
    onAvailable: () => void;
    onUnavailable: () => void;
    onPlay: () => void;
    onPause: () => void;
    onEnded: () => void;
}) {
    const videoRef = React.useRef<HTMLVideoElement>(null);

    React.useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        let cancelled = false;
        let hls: any = null;

        const cleanupVideo = () => {
            try { video.pause(); } catch { }
            video.removeAttribute("src");
            try { video.load(); } catch { }
        };

        cleanupVideo();

        const nativeHls = video.canPlayType("application/vnd.apple.mpegurl")
            || video.canPlayType("application/x-mpegURL");

        if (nativeHls) {
            video.src = hlsUrl;
            onAvailable();
            return cleanupVideo;
        }

        void (async () => {
            try {
                const Hls = await HlsRuntime.loadHls();
                if (cancelled || !videoRef.current || !Hls?.isSupported?.()) {
                    if (!cancelled) onUnavailable();
                    return;
                }

                hls = new Hls({
                    startLevel: -1,
                    startFragPrefetch: true,
                    backBufferLength: 90,
                    maxBufferLength: 90
                });

                hls.loadSource(hlsUrl);
                hls.attachMedia(video);
                onAvailable();

                if (Hls.Events?.ERROR) {
                    hls.on(Hls.Events.ERROR, (_event: unknown, data: any) => {
                        if (!data?.fatal || cancelled) return;
                        try { hls?.destroy?.(); } catch { }
                        hls = null;
                        onUnavailable();
                    });
                }
            } catch (error) {
                console.warn("[DesktopBounties] Failed to initialize Discord HLS playback", error);
                if (!cancelled) onUnavailable();
            }
        })();

        return () => {
            cancelled = true;
            try { hls?.destroy?.(); } catch { }
            cleanupVideo();
        };
    }, [hlsUrl]);

    return (
        <video
            ref={videoRef}
            poster={poster}
            playsInline
            controls
            preload="metadata"
            onPlay={onPlay}
            onPause={onPause}
            onEnded={onEnded}
        />
    );
}

export function BountiesNavItem() {
    const [active, setActive] = React.useState(isBountiesRoute);
    const [nativeClasses, setNativeClasses] = React.useState<NativeNavClasses>(FALLBACK_NAV_CLASSES);

    React.useEffect(() => {
        const sync = () => {
            const nextActive = isBountiesRoute();
            setActive(current => current === nextActive ? current : nextActive);

            const nextClasses = readNativeNavClasses();
            setNativeClasses(current => sameNativeNavClasses(current, nextClasses) ? current : nextClasses);

            if (nextActive) {
                const questInteractive = topShortcutLink("quests")?.parentElement as HTMLElement | null;
                if (questInteractive && questInteractive.className !== nextClasses.interactive) {
                    questInteractive.className = nextClasses.interactive;
                    questInteractive.removeAttribute("aria-current");
                }
            }
        };

        sync();
        const interval = window.setInterval(sync, 400);
        return () => window.clearInterval(interval);
    }, []);

    return (
        <div className={`${nativeClasses.wrapper} vc-desktop-bounties-navShell`} data-vc-desktop-bounties-nav="true">
            <li className={nativeClasses.channel} role="listitem">
                <div className={active ? nativeClasses.interactiveSelected : nativeClasses.interactive}>
                    <a
                        className={`${nativeClasses.link} vc-desktop-bounties-navLink`}
                        data-list-item-id="private-channels-uid_11___bounties"
                        tabIndex={-1}
                        href={BOUNTIES_ROUTE}
                        aria-current={active ? "page" : undefined}
                        onClick={event => {
                            event.preventDefault();
                            openBountiesPage();
                        }}
                    >
                        <div className={nativeClasses.layout}>
                            <div className={nativeClasses.avatar}>
                                <BountyIcon className={nativeClasses.icon} />
                            </div>
                            <div className={nativeClasses.content}>
                                <div className={nativeClasses.nameAndDecorators}>
                                    <div className={nativeClasses.name}>Bounties</div>
                                </div>
                            </div>
                        </div>
                    </a>
                </div>
            </li>
        </div>
    );
}

function BountyCard({
    decision,
    onClaimed
}: {
    decision: AdDecision;
    onClaimed: (id: string) => void;
}) {
    const content = getBountyContent(decision);
    if (!content) return null;

    const image = mediaUrl(content.image_preview ?? content.product_icon);
    const fullHls = mediaUrl(content.video_hls);
    const icon = mediaUrl(content.product_icon);
    const ctaUrl = safeExternalUrl(content.cta?.url);
    const targetSeconds = Math.max(1, content.reward_timer_seconds ?? 15);

    const [watchedSeconds, setWatchedSeconds] = React.useState(() =>
        Math.min(targetSeconds, getSavedProgress(content.id))
    );
    const [claimState, setClaimState] = React.useState<ClaimState>("idle");
    const [claimError, setClaimError] = React.useState<string | null>(null);
    const [videoAvailable, setVideoAvailable] = React.useState(Boolean(fullHls));
    const [isPlaying, setIsPlaying] = React.useState(false);

    const isPlayingRef = React.useRef(false);
    const lastTickRef = React.useRef<number | null>(null);
    const wholeSeconds = Math.floor(watchedSeconds);
    const progressPercent = Math.min(100, Math.round((watchedSeconds / targetSeconds) * 100));

    const doClaim = React.useCallback(async () => {
        if (claimState === "claiming") return;

        setClaimState("claiming");
        setClaimError(null);

        try {
            await claimBounty(decision);
            onClaimed(content.id);
        } catch (error) {
            console.error("[DesktopBounties] Discord rejected Bounty claim", error);
            setClaimError(getErrorMessage(error));
            setClaimState("error");
        }
    }, [claimState, decision, content.id, onClaimed]);

    React.useEffect(() => {
        saveProgress(content.id, wholeSeconds);
    }, [content.id, wholeSeconds]);

    React.useEffect(() => {
        const interval = window.setInterval(() => {
            const now = performance.now();

            if (
                !fullHls
                || !videoAvailable
                || !isPlayingRef.current
                || document.visibilityState !== "visible"
                || !document.hasFocus()
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
    }, [fullHls, videoAvailable, targetSeconds, claimState]);

    React.useEffect(() => {
        if (watchedSeconds >= targetSeconds && claimState === "idle" && fullHls && videoAvailable) {
            void doClaim();
        }
    }, [watchedSeconds, targetSeconds, claimState, fullHls, videoAvailable, doClaim]);

    const statusText = (() => {
        if (!fullHls || !videoAvailable) return "Full video unavailable";
        if (claimState === "claiming") return "Watch complete — claiming reward…";
        if (claimState === "error") return "Watch complete — retry the claim";
        if (watchedSeconds >= targetSeconds) return "Watch complete — ready to claim";
        if (isPlaying) return `${wholeSeconds}s of ${targetSeconds}s watched`;
        if (wholeSeconds > 0) return `${wholeSeconds}s of ${targetSeconds}s — resume video`;
        return `Watch ${targetSeconds}s to complete`;
    })();

    return (
        <article className="vc-desktop-bounties-card">
            <div className="vc-desktop-bounties-media">
                {fullHls && videoAvailable ? (
                    <FullBountyVideo
                        hlsUrl={fullHls}
                        poster={image}
                        onAvailable={() => setVideoAvailable(true)}
                        onUnavailable={() => {
                            isPlayingRef.current = false;
                            setIsPlaying(false);
                            setVideoAvailable(false);
                        }}
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
                    />
                ) : image ? (
                    <img src={image} alt="" />
                ) : (
                    <div className="vc-desktop-bounties-mediaFallback"><BountyIcon /></div>
                )}

                <span className={`vc-desktop-bounties-statusPill${wholeSeconds > 0 ? " vc-desktop-bounties-statusPill--progress" : ""}`}>
                    {wholeSeconds > 0 ? "In progress" : "Available"}
                </span>
            </div>

            <div className="vc-desktop-bounties-body">
                <div className="vc-desktop-bounties-titleRow">
                    {icon && <img className="vc-desktop-bounties-icon" src={icon} alt="" />}
                    <div className="vc-desktop-bounties-titleText">
                        <strong>{content.product_name || content.advertiser_name || "Bounty"}</strong>
                        {content.advertiser_name && content.product_name && <span>Promoted by {content.advertiser_name}</span>}
                    </div>
                </div>

                <div className="vc-desktop-bounties-progressText">
                    <span>{statusText}</span>
                    <strong>{progressPercent}%</strong>
                </div>

                <div
                    className="vc-desktop-bounties-progress"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progressPercent}
                >
                    <div style={{ width: `${progressPercent}%` }} />
                </div>

                {(!fullHls || !videoAvailable) && (
                    <div className="vc-desktop-bounties-infoBox">
                        Discord did not provide a playable full HLS stream for this Bounty. The short preview is not used.
                    </div>
                )}

                {claimError && (
                    <div className="vc-desktop-bounties-claimError">
                        <strong>Discord did not accept the claim.</strong>
                        <span>{claimError}</span>
                    </div>
                )}

                <div className="vc-desktop-bounties-cardFooter">
                    <span className="vc-desktop-bounties-requirement">{targetSeconds}s required</span>
                    <div className="vc-desktop-bounties-actions">
                        {claimState === "error" && watchedSeconds >= targetSeconds && (
                            <button className="vc-desktop-bounties-primaryButton" onClick={() => void doClaim()}>
                                Retry claim
                            </button>
                        )}
                        <button
                            className="vc-desktop-bounties-secondaryButton"
                            disabled={!ctaUrl}
                            onClick={() => openExternal(ctaUrl)}
                        >
                            {content.cta?.button_label || "View"}
                        </button>
                    </div>
                </div>
            </div>
        </article>
    );
}

function BountiesPage() {
    const currentUserId = useStateFromStores(
        [UserStore],
        () => UserStore.getCurrentUser()?.id ?? null
    );

    const [result, setResult] = React.useState<LoadResult | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const loadInFlightRef = React.useRef(false);
    const lastAutoRefreshRef = React.useRef(0);

    const load = React.useCallback(async (background = false) => {
        if (!currentUserId || loadInFlightRef.current) return;

        loadInFlightRef.current = true;
        lastAutoRefreshRef.current = Date.now();

        if (!background) setLoading(true);
        setError(null);

        try {
            setResult(await fetchBounties());
        } catch (err) {
            console.error("[DesktopBounties] Failed to fetch Bounties", err);
            setError(getErrorMessage(err));
        } finally {
            if (!background) setLoading(false);
            loadInFlightRef.current = false;
        }
    }, [currentUserId]);

    React.useEffect(() => {
        setResult(null);
        setError(null);

        if (!currentUserId) {
            setLoading(true);
            return;
        }

        const timeout = window.setTimeout(() => {
            void load(false);
        }, 500);

        return () => window.clearTimeout(timeout);
    }, [currentUserId, load]);

    // Returning to Discord or to this route refreshes automatically. The short
    // cooldown prevents focus + visibilitychange from issuing duplicate scans.
    React.useEffect(() => {
        if (!currentUserId) return;

        const refreshIfVisible = () => {
            if (document.visibilityState !== "visible" || !document.hasFocus() || !isBountiesRoute()) return;

            const now = Date.now();
            if (now - lastAutoRefreshRef.current < 5000) return;

            lastAutoRefreshRef.current = now;
            void load(true);
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") refreshIfVisible();
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.addEventListener("focus", refreshIfVisible);
        window.addEventListener("popstate", refreshIfVisible);

        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            window.removeEventListener("focus", refreshIfVisible);
            window.removeEventListener("popstate", refreshIfVisible);
        };
    }, [currentUserId, load]);

    const bounties = result?.bounties ?? [];

    const handleClaimed = React.useCallback((id: string) => {
        setResult(current => current == null ? current : {
            ...current,
            bounties: current.bounties.filter(decision => getBountyContent(decision)?.id !== id)
        });
        window.setTimeout(() => void load(true), 750);
    }, [load]);

    return (
        <div className="vc-desktop-bounties-page">
            <div className="vc-desktop-bounties-toolbar">
                <div className="vc-desktop-bounties-nativeOrb">
                    <NativeOrbBalanceMenu
                        showNotificationBadge={false}
                        ctaText="Open Orbs"
                        ctaOnClick={() => NavigationRouter.transitionTo("/shop?tab=orbs")}
                    />
                </div>
            </div>

            <main className="vc-desktop-bounties-pageInner">
                <section className="vc-desktop-bounties-section">
                    <div className="vc-desktop-bounties-sectionHeader">
                        <div>
                            <div className="vc-desktop-bounties-sectionTitleRow">
                                <h1>Available Bounties</h1>
                                <span className="vc-desktop-bounties-sectionCount">{bounties.length}</span>
                            </div>
                            <p>Sponsored videos still available to complete on your Discord account.</p>
                        </div>
                    </div>

                    {error && (
                        <div className="vc-desktop-bounties-state vc-desktop-bounties-error">
                            <strong>Could not load Bounties</strong>
                            <span>{error}</span>
                        </div>
                    )}

                    {loading && !result ? (
                        <div className="vc-desktop-bounties-skeletonGrid">
                            <div className="vc-desktop-bounties-skeletonCard" />
                            <div className="vc-desktop-bounties-skeletonCard" />
                            <div className="vc-desktop-bounties-skeletonCard" />
                        </div>
                    ) : bounties.length > 0 ? (
                        <div className="vc-desktop-bounties-grid">
                            {bounties.map((decision, index) => (
                                <BountyCard
                                    key={getBountyContent(decision)?.id ?? index}
                                    decision={decision}
                                    onClaimed={handleClaimed}
                                />
                            ))}
                        </div>
                    ) : !error && (
                        <div className="vc-desktop-bounties-emptyState">
                            <div className="vc-desktop-bounties-emptyIcon"><BountyIcon /></div>
                            <div>
                                <h3>No Bounties available</h3>
                                <p>Discord is not currently serving any uncompleted Bounties to this account.</p>
                            </div>
                        </div>
                    )}
                </section>
            </main>
        </div>
    );
}

export function renderBountiesPage() {
    return React.createElement(BountiesPage);
}
