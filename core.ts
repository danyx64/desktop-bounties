import { filters, findByPropsLazy, findStoreLazy, mapMangledModuleLazy } from "@webpack";
import { NavigationRouter, RestAPI, UserStore } from "@webpack/common";

export const QUEST_HOME_MOBILE_CAROUSEL_PLACEMENT = 4;
export const BOUNTY_CREATIVE_TYPE = 3;
export const MAX_DECISIONS = 5;
export const BOUNTIES_ROUTE_PARAM = "vc_bounties";
export const BOUNTIES_ROUTE = `/quest-home?${BOUNTIES_ROUTE_PARAM}=1`;

const AD_SESSION_STORAGE_KEY = "vc-desktop-bounties-ad-session-v1";
const PROGRESS_STORAGE_KEY = "vc-desktop-bounties-progress-v1";
const CLAIMED_STORAGE_KEY = "vc-desktop-bounties-claimed-v1";
const AD_SESSION_IDLE_MS = 30 * 60 * 1000;
const AD_SESSION_MAX_MS = 12 * 60 * 60 * 1000;

const LEGACY_GLOBAL_KEYS = [
    AD_SESSION_STORAGE_KEY,
    PROGRESS_STORAGE_KEY,
    CLAIMED_STORAGE_KEY,
    "vc-desktop-bounties-claimed-snapshots-v1",
    "vc-desktop-bounties-seen-v1",
    "vc-desktop-bounties-video-quest-history-v1"
];

interface DiscordSession {
    uuid?: string;
    createdAtTimestamp?: number;
    lastUsedTimestamp?: number;
}

const NativeHeartbeatSession = mapMangledModuleLazy("LAST_CLIENT_HEARTBEAT_SESSION", {
    getSession: filters.byCode("handleUpdateTimeSpentSessionId", "lastUsedTimestamp")
}) as {
    getSession?: (updateGateway?: boolean) => Promise<DiscordSession | null>;
};

const NativeAdSession = mapMangledModuleLazy("AD_SESSION_RESET", {
    getOrRefreshAdSession: filters.byCode("createdAtTimestamp", "lastUsedTimestamp", "AD_SESSION_RESET")
}) as {
    getOrRefreshAdSession?: (updateLastUsed?: boolean) => DiscordSession | null;
};

const NetworkStore = findStoreLazy("NetworkStore") as {
    getType?: () => unknown;
};

const GuildStore = findStoreLazy("GuildStore") as {
    getGuilds?: () => Record<string, unknown>;
};

const AnalyticsUtils = findByPropsLazy(
    "getSuperProperties",
    "getSuperPropertiesBase64",
    "extendSuperProperties"
) as {
    getSuperProperties?: () => Record<string, unknown>;
};

const MOBILE_CLIENT_VERSION = "347.4 - rn";
const MOBILE_CLIENT_BUILD_NUMBER = 6453;
const MOBILE_RELEASE_CHANNEL = "googleRelease";

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
    quest?: unknown;
    request_id?: string | number;
    ad_identifiers?: {
        creative_type?: number;
        creative_id?: string;
        ad_content_id?: string;
        [key: string]: unknown;
    } | null;
    metadata_sealed?: string;
    traffic_metadata_sealed?: string;
    provenance_metadata_sealed?: string;
    ad_context?: unknown;
    response_ttl_seconds?: number;
    [key: string]: unknown;
}

interface DecisionsResponse {
    request_id?: string;
    decisions?: AdDecision[];
}

export interface ScanAttempt {
    endpoint: "/quests/get-decisions" | "/quests/decision";
    visibleGuildIds: boolean;
    returned: number;
    bountyCount: number;
    creativeTypes: Array<number | null>;
}

export interface LoadResult {
    requestId?: string;
    decisions: AdDecision[];
    bounties: AdDecision[];
    clientAdSessionId: string;
    clientHeartbeatSessionId?: string;
    source: "get-decisions" | "quests-decision" | "none";
    attempts: ScanAttempt[];
}

interface StoredAdSession {
    id: string;
    createdAt: number;
    lastUsedAt: number;
}

interface RequestContext {
    clientAdSessionId: string;
    clientHeartbeatSessionId?: string;
    connectionType?: unknown;
}

function currentUserId(): string {
    return UserStore.getCurrentUser()?.id ?? "unknown-user";
}

function scopedStorageKey(base: string): string {
    return `${base}:${currentUserId()}`;
}

function clearLegacyGlobalState() {
    try {
        for (const key of LEGACY_GLOBAL_KEYS) localStorage.removeItem(key);
    } catch { }
}

function createUuid(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();

    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

function getFallbackAdSessionId(): string {
    const now = Date.now();
    const key = scopedStorageKey(AD_SESSION_STORAGE_KEY);

    try {
        const raw = localStorage.getItem(key);
        if (raw) {
            const stored = JSON.parse(raw) as StoredAdSession;
            if (
                stored.id
                && now - stored.lastUsedAt < AD_SESSION_IDLE_MS
                && now - stored.createdAt < AD_SESSION_MAX_MS
            ) {
                localStorage.setItem(key, JSON.stringify({ ...stored, lastUsedAt: now }));
                return stored.id;
            }
        }
    } catch { }

    const fresh: StoredAdSession = {
        id: createUuid(),
        createdAt: now,
        lastUsedAt: now
    };

    try {
        localStorage.setItem(key, JSON.stringify(fresh));
    } catch { }

    return fresh.id;
}

export function getAdSessionId(): string {
    try {
        const native = NativeAdSession.getOrRefreshAdSession?.();
        if (native?.uuid) return native.uuid;
    } catch (error) {
        console.warn("[DesktopBounties] Could not reuse Discord ad session", error);
    }

    return getFallbackAdSessionId();
}

async function getHeartbeatSessionId(): Promise<string | undefined> {
    try {
        const native = await NativeHeartbeatSession.getSession?.();
        return native?.uuid || undefined;
    } catch (error) {
        console.warn("[DesktopBounties] Could not reuse Discord heartbeat session", error);
        return undefined;
    }
}

function getConnectionType(): unknown {
    try {
        return NetworkStore.getType?.();
    } catch {
        return undefined;
    }
}

function getGuildIds(): string[] {
    try {
        return Object.keys(GuildStore.getGuilds?.() ?? {}).slice(0, 50);
    } catch {
        return [];
    }
}

function readProgress(): Record<string, number> {
    try {
        return JSON.parse(localStorage.getItem(scopedStorageKey(PROGRESS_STORAGE_KEY)) ?? "{}") as Record<string, number>;
    } catch {
        return {};
    }
}

export function getSavedProgress(id: string): number {
    return Math.max(0, Number(readProgress()[id]) || 0);
}

export function saveProgress(id: string, seconds: number) {
    try {
        const all = readProgress();
        all[id] = Math.max(0, seconds);
        localStorage.setItem(scopedStorageKey(PROGRESS_STORAGE_KEY), JSON.stringify(all));
    } catch { }
}

function readClaimedIds(): Set<string> {
    try {
        const ids = JSON.parse(localStorage.getItem(scopedStorageKey(CLAIMED_STORAGE_KEY)) ?? "[]") as string[];
        return new Set(Array.isArray(ids) ? ids : []);
    } catch {
        return new Set();
    }
}

function isLocallyClaimed(id: string): boolean {
    return readClaimedIds().has(id);
}

export function rememberClaimed(id: string) {
    try {
        const ids = readClaimedIds();
        ids.add(id);
        localStorage.setItem(scopedStorageKey(CLAIMED_STORAGE_KEY), JSON.stringify([...ids]));
    } catch { }
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
    } catch {
        return undefined;
    }
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
        const maybeError = error as {
            body?: { message?: string; code?: number; };
            message?: string;
            status?: number;
        };

        if (maybeError.body?.message) {
            return `${maybeError.body.message}${maybeError.body.code != null ? ` (${maybeError.body.code})` : ""}`;
        }
        if (maybeError.message) return maybeError.message;
        if (maybeError.status != null) return `HTTP ${maybeError.status}`;
    }

    return String(error);
}

export function getCreativeType(decision: AdDecision): number | undefined {
    return decision.creative?.creative_type
        ?? decision.creative?.type
        ?? decision.ad_identifiers?.creative_type;
}

export function getBountyContent(decision: AdDecision): BountyCreativeContent | undefined {
    return decision.creative?.creative_content;
}

function filterBounties(decisions: AdDecision[]): AdDecision[] {
    return decisions.filter(decision => {
        const content = getBountyContent(decision);
        return getCreativeType(decision) === BOUNTY_CREATIVE_TYPE
            && content != null
            && !isLocallyClaimed(content.id);
    });
}

function makeRequestContext(connectionType: unknown): Record<string, unknown> | undefined {
    return connectionType == null ? undefined : { connection_type: connectionType };
}

function encodeBase64Json(value: unknown): string {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = "";

    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function getMobileSuperPropertiesBase64(): string | undefined {
    try {
        const current = AnalyticsUtils.getSuperProperties?.() ?? {};
        const mobile: Record<string, unknown> = {
            ...current,
            os: "Android",
            browser: "Discord Android",
            device: "Android",
            system_locale: navigator.language || "en-US",
            client_version: MOBILE_CLIENT_VERSION,
            release_channel: MOBILE_RELEASE_CHANNEL,
            client_build_number: MOBILE_CLIENT_BUILD_NUMBER,
            design_id: 2,
            client_event_source: null
        };

        // Electron-only fields conflict with the Android identity Discord mobile
        // sends in X-Super-Properties, so do not carry them into this request.
        for (const key of [
            "os_arch",
            "app_arch",
            "window_manager",
            "distro",
            "runtime_environment",
            "display_server",
            "os_sdk_version"
        ]) {
            delete mobile[key];
        }

        return encodeBase64Json(mobile);
    } catch (error) {
        console.warn("[DesktopBounties] Could not build mobile super properties", error);
        return undefined;
    }
}

function attachMobileDeliveryHeaders(request: any) {
    const mobileSuperProperties = getMobileSuperPropertiesBase64();
    if (!mobileSuperProperties) return;

    request.headers = {
        ...(request.headers ?? {}),
        "X-Super-Properties": mobileSuperProperties
    };
}

async function fetchQuestHomeBountyDecisions(context: RequestContext): Promise<{
    requestId?: string;
    decisions: AdDecision[];
}> {
    const query: Record<string, string | number> = {
        placement: QUEST_HOME_MOBILE_CAROUSEL_PLACEMENT,
        client_ad_session_id: context.clientAdSessionId,
        num_decisions_requested: MAX_DECISIONS
    };

    if (context.clientHeartbeatSessionId) {
        query.client_heartbeat_session_id = context.clientHeartbeatSessionId;
    }

    const request: any = {
        url: "/quests/get-decisions",
        query,
        rejectWithError: false
    };

    const requestContext = makeRequestContext(context.connectionType);
    if (requestContext) request.context = requestContext;
    attachMobileDeliveryHeaders(request);

    const response = await (RestAPI.get as any)(request);
    const body = (response?.body ?? {}) as DecisionsResponse;

    return {
        requestId: body.request_id,
        decisions: Array.isArray(body.decisions) ? body.decisions : []
    };
}

async function fetchSingleQuestDecision(
    context: RequestContext,
    visibleGuildIds?: string[]
): Promise<{
    requestId?: string;
    decision: AdDecision | null;
}> {
    const params = new URLSearchParams({
        placement: String(QUEST_HOME_MOBILE_CAROUSEL_PLACEMENT)
    });

    if (context.clientHeartbeatSessionId) {
        params.append("client_heartbeat_session_id", context.clientHeartbeatSessionId);
    }

    params.append("client_ad_session_id", context.clientAdSessionId);

    for (const guildId of visibleGuildIds ?? []) {
        params.append("visible_guild_ids", guildId);
    }

    const request: any = {
        url: `/quests/decision?${params.toString()}`,
        rejectWithError: false
    };

    const requestContext = makeRequestContext(context.connectionType);
    if (requestContext) request.context = requestContext;
    attachMobileDeliveryHeaders(request);

    const response = await (RestAPI.get as any)(request);
    const body = response?.body;

    if (body == null || typeof body !== "object") {
        return { decision: null };
    }

    return {
        requestId: body.request_id != null ? String(body.request_id) : undefined,
        decision: body as AdDecision
    };
}

function scanAttempt(
    endpoint: ScanAttempt["endpoint"],
    decisions: AdDecision[],
    visibleGuildIds: boolean
): ScanAttempt {
    const bounties = filterBounties(decisions);

    return {
        endpoint,
        visibleGuildIds,
        returned: decisions.filter(decision => decision.creative != null).length,
        bountyCount: bounties.length,
        creativeTypes: decisions.map(decision => getCreativeType(decision) ?? null)
    };
}

export async function fetchBounties(): Promise<LoadResult> {
    clearLegacyGlobalState();

    const clientAdSessionId = getAdSessionId();
    const clientHeartbeatSessionId = await getHeartbeatSessionId();
    const connectionType = getConnectionType();

    const context: RequestContext = {
        clientAdSessionId,
        clientHeartbeatSessionId,
        connectionType
    };

    const attempts: ScanAttempt[] = [];

    // This is the exact Quest Home Bounty endpoint used by Discord mobile.
    const multi = await fetchQuestHomeBountyDecisions(context);
    const multiBounties = filterBounties(multi.decisions);
    attempts.push(scanAttempt("/quests/get-decisions", multi.decisions, false));

    if (multiBounties.length > 0) {
        console.info("[DesktopBounties] scan result", {
            userId: currentUserId(),
            placement: QUEST_HOME_MOBILE_CAROUSEL_PLACEMENT,
            source: "get-decisions",
            mobileIdentityHeader: Boolean(getMobileSuperPropertiesBase64()),
            hasHeartbeatSession: Boolean(clientHeartbeatSessionId),
            connectionType,
            attempts
        });

        return {
            requestId: multi.requestId,
            decisions: multi.decisions,
            bounties: multiBounties,
            clientAdSessionId,
            clientHeartbeatSessionId,
            source: "get-decisions",
            attempts
        };
    }

    // Desktop's QuestActionCreators also uses /quests/decision and explicitly
    // supports BOUNTY creatives. Try the native desktop delivery path as a
    // fallback when the mobile carousel endpoint returns no Bounties.
    const single = await fetchSingleQuestDecision(context);
    const singleDecisions = single.decision ? [single.decision] : [];
    const singleBounties = filterBounties(singleDecisions);
    attempts.push(scanAttempt("/quests/decision", singleDecisions, false));

    if (singleBounties.length > 0) {
        console.info("[DesktopBounties] scan result", {
            userId: currentUserId(),
            placement: QUEST_HOME_MOBILE_CAROUSEL_PLACEMENT,
            source: "quests-decision",
            mobileIdentityHeader: Boolean(getMobileSuperPropertiesBase64()),
            hasHeartbeatSession: Boolean(clientHeartbeatSessionId),
            connectionType,
            attempts
        });

        return {
            requestId: single.requestId,
            decisions: singleDecisions,
            bounties: singleBounties,
            clientAdSessionId,
            clientHeartbeatSessionId,
            source: "quests-decision",
            attempts
        };
    }

    // Discord conditionally includes visible_guild_ids in /quests/decision for
    // less-personalized delivery. Try that legitimate request shape as a final
    // fallback rather than spoofing mobile client identity or account targeting.
    const guildIds = getGuildIds();
    if (guildIds.length > 0) {
        const singleWithGuilds = await fetchSingleQuestDecision(context, guildIds);
        const singleWithGuildsDecisions = singleWithGuilds.decision ? [singleWithGuilds.decision] : [];
        const singleWithGuildsBounties = filterBounties(singleWithGuildsDecisions);
        attempts.push(scanAttempt("/quests/decision", singleWithGuildsDecisions, true));

        if (singleWithGuildsBounties.length > 0) {
            console.info("[DesktopBounties] scan result", {
                userId: currentUserId(),
                placement: QUEST_HOME_MOBILE_CAROUSEL_PLACEMENT,
                source: "quests-decision",
                mobileIdentityHeader: Boolean(getMobileSuperPropertiesBase64()),
                hasHeartbeatSession: Boolean(clientHeartbeatSessionId),
                connectionType,
                attempts
            });

            return {
                requestId: singleWithGuilds.requestId,
                decisions: singleWithGuildsDecisions,
                bounties: singleWithGuildsBounties,
                clientAdSessionId,
                clientHeartbeatSessionId,
                source: "quests-decision",
                attempts
            };
        }
    }

    console.info("[DesktopBounties] scan result", {
        userId: currentUserId(),
        placement: QUEST_HOME_MOBILE_CAROUSEL_PLACEMENT,
        source: "none",
        mobileIdentityHeader: Boolean(getMobileSuperPropertiesBase64()),
        hasHeartbeatSession: Boolean(clientHeartbeatSessionId),
        connectionType,
        attempts
    });

    return {
        requestId: multi.requestId,
        decisions: multi.decisions,
        bounties: [],
        clientAdSessionId,
        clientHeartbeatSessionId,
        source: "none",
        attempts
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

    const body: Record<string, string | null> = {
        client_ad_session_id: clientAdSessionId,
        client_heartbeat_session_id: null,
        decision_metadata_sealed: decision.metadata_sealed ?? null,
        traffic_metadata_sealed: decision.traffic_metadata_sealed ?? null
    };

    const clientHeartbeatSessionId = await getHeartbeatSessionId();
    if (clientHeartbeatSessionId) body.client_heartbeat_session_id = clientHeartbeatSessionId;

    const request: any = {
        url: `/quests/creatives/${content.id}/claim-reward`,
        body
    };
    attachMobileDeliveryHeaders(request);

    await (RestAPI.post as any)(request);

    rememberClaimed(content.id);
}

export function isBountiesRoute(): boolean {
    return location.pathname === "/quest-home"
        && new URLSearchParams(location.search).get(BOUNTIES_ROUTE_PARAM) === "1";
}

export function openBountiesPage() {
    NavigationRouter.transitionTo(BOUNTIES_ROUTE);
}
