import { NavigationRouter, RestAPI } from "@webpack/common";

export const QUEST_HOME_MOBILE_CAROUSEL_PLACEMENT = 4;
export const BOUNTY_CREATIVE_TYPE = 3;
export const MAX_DECISIONS = 15;
export const BOUNTIES_ROUTE_PARAM = "vc_bounties";
export const BOUNTIES_ROUTE = `/quest-home?${BOUNTIES_ROUTE_PARAM}=1`;

const AD_SESSION_STORAGE_KEY = "vc-desktop-bounties-ad-session-v1";
const PROGRESS_STORAGE_KEY = "vc-desktop-bounties-progress-v1";
const CLAIMED_STORAGE_KEY = "vc-desktop-bounties-claimed-v1";
const CLAIMED_SNAPSHOTS_STORAGE_KEY = "vc-desktop-bounties-claimed-snapshots-v1";
const SEEN_BOUNTIES_STORAGE_KEY = "vc-desktop-bounties-seen-v1";
const VIDEO_QUEST_HISTORY_STORAGE_KEY = "vc-desktop-bounties-video-quest-history-v1";
const AD_SESSION_IDLE_MS = 30 * 60 * 1000;
const AD_SESSION_MAX_MS = 12 * 60 * 60 * 1000;

// Features which only make sense on video quests and can still be present in the
// reduced object returned by /quests/@me/claimed after the full task config is gone.
const VIDEO_QUEST_FEATURE_HINTS = new Set([18, 19, 35]);

export interface BountyCTA {
    url?: string;
    button_label?: string;
}

export interface BountyCreativeContent {
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

export interface BountyCreative {
    type?: number;
    creative_type?: number;
    creative_content?: BountyCreativeContent;
    starts_at?: string;
    ends_at?: string;
}

export interface AdDecision {
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

export interface LoadResult {
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

export interface ClaimedSnapshot extends BountyCreativeContent {
    claimedAt: number;
}

export interface SeenBountySnapshot extends BountyCreativeContent {
    firstSeenAt: number;
    lastSeenAt: number;
    startsAt?: string;
    endsAt?: string;
}

export interface VideoQuestHistoryItem {
    id: string;
    title: string;
    gameTitle?: string;
    publisher?: string;
    claimedAt?: number;
    expiresAt?: string;
    targetSeconds?: number;
    videoHls?: string;
    videoUrl?: string;
    thumbnail?: string;
    archivedOnly?: boolean;
}

function createUuid(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

export function getAdSessionId(): string {
    const now = Date.now();
    try {
        const raw = localStorage.getItem(AD_SESSION_STORAGE_KEY);
        if (raw) {
            const stored = JSON.parse(raw) as StoredAdSession;
            if (stored.id && now - stored.lastUsedAt < AD_SESSION_IDLE_MS && now - stored.createdAt < AD_SESSION_MAX_MS) {
                localStorage.setItem(AD_SESSION_STORAGE_KEY, JSON.stringify({ ...stored, lastUsedAt: now }));
                return stored.id;
            }
        }
    } catch { }

    const fresh: StoredAdSession = { id: createUuid(), createdAt: now, lastUsedAt: now };
    try { localStorage.setItem(AD_SESSION_STORAGE_KEY, JSON.stringify(fresh)); } catch { }
    return fresh.id;
}

function readProgress(): Record<string, number> {
    try { return JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY) ?? "{}") as Record<string, number>; }
    catch { return {}; }
}

export function getSavedProgress(id: string): number {
    return Math.max(0, Number(readProgress()[id]) || 0);
}

export function saveProgress(id: string, seconds: number) {
    try {
        const all = readProgress();
        all[id] = Math.max(0, seconds);
        localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(all));
    } catch { }
}

export function readClaimedIds(): Set<string> {
    try {
        const ids = JSON.parse(localStorage.getItem(CLAIMED_STORAGE_KEY) ?? "[]") as string[];
        return new Set(Array.isArray(ids) ? ids : []);
    } catch { return new Set(); }
}

export function readClaimedSnapshots(): ClaimedSnapshot[] {
    try {
        const snapshots = JSON.parse(localStorage.getItem(CLAIMED_SNAPSHOTS_STORAGE_KEY) ?? "[]") as ClaimedSnapshot[];
        return Array.isArray(snapshots) ? snapshots.filter(snapshot => Boolean(snapshot?.id)) : [];
    } catch { return []; }
}

export function readSeenBountySnapshots(): SeenBountySnapshot[] {
    try {
        const snapshots = JSON.parse(localStorage.getItem(SEEN_BOUNTIES_STORAGE_KEY) ?? "[]") as SeenBountySnapshot[];
        return Array.isArray(snapshots) ? snapshots.filter(snapshot => Boolean(snapshot?.id)) : [];
    } catch { return []; }
}

export function isLocallyClaimed(id: string): boolean {
    return readClaimedIds().has(id);
}

export function rememberClaimed(content: BountyCreativeContent) {
    try {
        const ids = readClaimedIds();
        ids.add(content.id);
        localStorage.setItem(CLAIMED_STORAGE_KEY, JSON.stringify([...ids]));

        const existing = readClaimedSnapshots();
        const previous = existing.find(snapshot => snapshot.id === content.id);
        const snapshots = existing.filter(snapshot => snapshot.id !== content.id);
        snapshots.unshift({
            ...content,
            claimedAt: previous?.claimedAt ?? Date.now()
        });

        localStorage.setItem(CLAIMED_SNAPSHOTS_STORAGE_KEY, JSON.stringify(snapshots));
    } catch { }
}

function rememberSeenBounties(decisions: AdDecision[]) {
    try {
        const now = Date.now();
        const existing = new Map(readSeenBountySnapshots().map(snapshot => [snapshot.id, snapshot]));

        for (const decision of decisions) {
            const content = getBountyContent(decision);
            if (!content?.id) continue;

            const previous = existing.get(content.id);
            existing.set(content.id, {
                ...previous,
                ...content,
                firstSeenAt: previous?.firstSeenAt ?? now,
                lastSeenAt: now,
                startsAt: decision.creative?.starts_at ?? previous?.startsAt,
                endsAt: decision.creative?.ends_at ?? previous?.endsAt
            });
        }

        localStorage.setItem(
            SEEN_BOUNTIES_STORAGE_KEY,
            JSON.stringify([...existing.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt))
        );
    } catch { }
}

export function snapshotToDecision(snapshot: ClaimedSnapshot | SeenBountySnapshot): AdDecision {
    const {
        claimedAt: _claimedAt,
        firstSeenAt: _firstSeenAt,
        lastSeenAt: _lastSeenAt,
        startsAt,
        endsAt,
        ...content
    } = snapshot as ClaimedSnapshot & Partial<SeenBountySnapshot>;

    return {
        creative: {
            type: BOUNTY_CREATIVE_TYPE,
            creative_type: BOUNTY_CREATIVE_TYPE,
            creative_content: content,
            starts_at: startsAt,
            ends_at: endsAt
        }
    };
}

export function claimedIdToDecision(id: string): AdDecision {
    return {
        creative: {
            type: BOUNTY_CREATIVE_TYPE,
            creative_type: BOUNTY_CREATIVE_TYPE,
            creative_content: {
                id,
                product_name: "Completed Bounty",
                advertiser_name: "Discord"
            }
        }
    };
}

export function mediaUrl(asset?: string): string | undefined {
    if (!asset) return undefined;
    if (/^(?:https?:|blob:|data:)/i.test(asset)) return asset;
    return `https://cdn.discordapp.com/${asset.replace(/^\/+/, "")}`;
}

export function safeExternalUrl(value?: string): string | undefined {
    if (!value) return undefined;
    try {
        const parsed = new URL(value);
        return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : undefined;
    } catch { return undefined; }
}

export function openExternal(value?: string) {
    const url = safeExternalUrl(value);
    if (!url) return;
    if (typeof VencordNative !== "undefined") VencordNative.native.openExternal(url);
    else window.open(url, "_blank", "noopener,noreferrer");
}

export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (error && typeof error === "object") {
        const maybeError = error as { body?: { message?: string; code?: number; }; message?: string; status?: number; };
        if (maybeError.body?.message) return `${maybeError.body.message}${maybeError.body.code != null ? ` (${maybeError.body.code})` : ""}`;
        if (maybeError.message) return maybeError.message;
        if (maybeError.status != null) return `HTTP ${maybeError.status}`;
    }
    return String(error);
}

export function getCreativeType(decision: AdDecision): number | undefined {
    return decision.creative?.creative_type ?? decision.creative?.type ?? decision.ad_identifiers?.creative_type;
}

export function getBountyContent(decision: AdDecision): BountyCreativeContent | undefined {
    return decision.creative?.creative_content;
}

export async function fetchBounties(): Promise<LoadResult> {
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

    rememberSeenBounties(bounties);

    return {
        requestId: body.request_id,
        decisions,
        bounties,
        clientAdSessionId
    };
}

export async function fetchOrbBalance(): Promise<number | null> {
    const response = await RestAPI.get({ url: "/users/@me/virtual-currency/balance" });
    const value = Number(response?.body?.balance);
    return Number.isFinite(value) ? value : null;
}

export async function claimBounty(decision: AdDecision, clientAdSessionId: string) {
    const content = getBountyContent(decision);
    if (!content?.id) throw new Error("Missing Bounty creative ID");
    const body: Record<string, string> = { client_ad_session_id: clientAdSessionId };
    if (decision.metadata_sealed) body.decision_metadata_sealed = decision.metadata_sealed;
    if (decision.traffic_metadata_sealed) body.traffic_metadata_sealed = decision.traffic_metadata_sealed;
    await RestAPI.post({ url: `/quests/creatives/${content.id}/claim-reward`, body });
}

function dateToTimestamp(value: unknown): number | undefined {
    if (typeof value !== "string" || !value) return undefined;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : undefined;
}

function getRawVideoTask(quest: any): any | null {
    const tasks = quest?.config?.task_config_v2?.tasks;
    if (!tasks || typeof tasks !== "object") return null;
    return tasks.WATCH_VIDEO ?? tasks.WATCH_VIDEO_ON_MOBILE ?? null;
}

function rawQuestToVideoHistory(quest: any): VideoQuestHistoryItem | null {
    const task = getRawVideoTask(quest);
    if (!task) return null;

    const claimedAt = dateToTimestamp(quest?.user_status?.claimed_at);
    if (!claimedAt) return null;

    const assets = task.assets ?? {};
    const videoHls = safeExternalUrl(assets.video_hls?.url);
    const videoUrl = safeExternalUrl(assets.video?.url) ?? safeExternalUrl(assets.video_low_res?.url);
    const thumbnail = safeExternalUrl(assets.video_hls?.thumbnail)
        ?? safeExternalUrl(assets.video?.thumbnail)
        ?? safeExternalUrl(assets.video_low_res?.thumbnail);

    return {
        id: String(quest.id),
        title: task.messages?.video_title ?? quest?.config?.messages?.quest_name ?? "Video Quest",
        gameTitle: quest?.config?.messages?.game_title,
        publisher: quest?.config?.messages?.game_publisher,
        claimedAt,
        expiresAt: quest?.config?.expires_at,
        targetSeconds: Number.isFinite(Number(task.target)) ? Number(task.target) : undefined,
        videoHls,
        videoUrl,
        thumbnail,
        archivedOnly: !videoHls && !videoUrl
    };
}

function claimedQuestMetadataToVideoHistory(quest: any): VideoQuestHistoryItem | null {
    const features = Array.isArray(quest?.config?.features) ? quest.config.features : [];
    if (!features.some((feature: unknown) => VIDEO_QUEST_FEATURE_HINTS.has(Number(feature)))) return null;

    const claimedAt = dateToTimestamp(quest?.user_status?.claimed_at);
    if (!claimedAt) return null;

    return {
        id: String(quest.id),
        title: quest?.config?.messages?.quest_name ?? "Archived Video Quest",
        gameTitle: quest?.config?.messages?.game_title,
        publisher: quest?.config?.messages?.game_publisher,
        claimedAt,
        expiresAt: quest?.config?.expires_at,
        archivedOnly: true
    };
}

export function readVideoQuestHistory(): VideoQuestHistoryItem[] {
    try {
        const items = JSON.parse(localStorage.getItem(VIDEO_QUEST_HISTORY_STORAGE_KEY) ?? "[]") as VideoQuestHistoryItem[];
        return Array.isArray(items) ? items.filter(item => Boolean(item?.id)) : [];
    } catch { return []; }
}

function videoHistoryRichness(item: VideoQuestHistoryItem): number {
    if (item.videoHls) return 4;
    if (item.videoUrl) return 3;
    if (item.thumbnail) return 2;
    return item.archivedOnly ? 0 : 1;
}

function mergeVideoQuestHistory(items: VideoQuestHistoryItem[]): VideoQuestHistoryItem[] {
    const byId = new Map<string, VideoQuestHistoryItem>();

    for (const item of [...readVideoQuestHistory(), ...items]) {
        if (!item?.id) continue;
        const previous = byId.get(item.id);

        if (!previous) {
            byId.set(item.id, item);
            continue;
        }

        const richer = videoHistoryRichness(item) >= videoHistoryRichness(previous) ? item : previous;
        byId.set(item.id, {
            ...previous,
            ...item,
            ...richer,
            claimedAt: Math.max(previous.claimedAt ?? 0, item.claimedAt ?? 0) || undefined,
            archivedOnly: !(richer.videoHls || richer.videoUrl)
        });
    }

    const merged = [...byId.values()].sort((a, b) => (b.claimedAt ?? 0) - (a.claimedAt ?? 0));
    try { localStorage.setItem(VIDEO_QUEST_HISTORY_STORAGE_KEY, JSON.stringify(merged)); } catch { }
    return merged;
}

export async function fetchVideoQuestHistory(): Promise<VideoQuestHistoryItem[]> {
    const discovered: VideoQuestHistoryItem[] = [];

    const [currentResult, claimedResult] = await Promise.allSettled([
        RestAPI.get({ url: "/quests/@me" }),
        RestAPI.get({ url: "/quests/@me/claimed" })
    ]);

    if (currentResult.status === "fulfilled") {
        const quests = Array.isArray(currentResult.value?.body?.quests) ? currentResult.value.body.quests : [];
        for (const quest of quests) {
            const item = rawQuestToVideoHistory(quest);
            if (item) discovered.push(item);
        }
    }

    if (claimedResult.status === "fulfilled") {
        const quests = Array.isArray(claimedResult.value?.body?.quests) ? claimedResult.value.body.quests : [];
        for (const quest of quests) {
            // /quests/@me/claimed intentionally returns a reduced config. If Discord
            // no longer exposes task assets, keep metadata for video-specific features.
            const metadataItem = claimedQuestMetadataToVideoHistory(quest);
            if (metadataItem) discovered.push(metadataItem);
        }
    }

    return mergeVideoQuestHistory(discovered);
}

export function isBountiesRoute(): boolean {
    return location.pathname === "/quest-home" && new URLSearchParams(location.search).get(BOUNTIES_ROUTE_PARAM) === "1";
}

export function openBountiesPage() {
    NavigationRouter.transitionTo(BOUNTIES_ROUTE);
}
