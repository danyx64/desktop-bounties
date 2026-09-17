import { filters, findStoreLazy, mapMangledModuleLazy } from "@webpack";
import { NavigationRouter, RestAPI, UserStore } from "@webpack/common";

export const QUEST_HOME_MOBILE_CAROUSEL_PLACEMENT = 4;
export const BOUNTY_CREATIVE_TYPE = 3;
// Discord mobile currently requests five Quest Home Bounty decisions at once.
export const MAX_DECISIONS = 5;
export const BOUNTIES_ROUTE_PARAM = "vc_bounties";
export const BOUNTIES_ROUTE = `/quest-home?${BOUNTIES_ROUTE_PARAM}=1`;

const AD_SESSION_STORAGE_KEY = "vc-desktop-bounties-ad-session-v1";
const PROGRESS_STORAGE_KEY = "vc-desktop-bounties-progress-v1";
const CLAIMED_STORAGE_KEY = "vc-desktop-bounties-claimed-v1";
const AD_SESSION_IDLE_MS = 30 * 60 * 1000;
const AD_SESSION_MAX_MS = 12 * 60 * 60 * 1000;

// Old builds used global localStorage keys. That meant completing a Bounty on
// account A could hide the same creative on account B. Everything stateful is
// account-scoped now.
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

// Discord's heartbeat session is token-aware and is reset when the active
// account changes, so it is safe to reuse for the mobile-style request.
const NativeHeartbeatSession = mapMangledModuleLazy("LAST_CLIENT_HEARTBEAT_SESSION", {
    getSession: filters.byCode("handleUpdateTimeSpentSessionId", "lastUsedTimestamp")
}) as {
    getSession?: (updateGateway?: boolean) => Promise<DiscordSession | null>;
};

// The official mobile request also passes the current connection type in the
// request context. RestAPI's public typings do not expose `context`, but the
// underlying Discord HTTP client accepts it.
const NetworkStore = findStoreLazy("NetworkStore") as {
    getType?: () => unknown;
};

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
    clientHeartbeatSessionId?: string;
}

interface StoredAdSession {
    id: string;
    createdAt: number;
    lastUsedAt: number;
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

// Keep one ad-session UUID per Discord account. The UUID is client-generated in
// Discord itself; scoping it here avoids carrying account A's ad session into
// account B when using Discord's account switcher.
function getFallbackAdSessionId(): string {
    const now = Date.now();
    const key = scopedStorageKey(AD_SESSION_STORAGE_KEY);

    try {
        const raw = localStorage.getItem(key);
        if (raw) {
            const stored = JSON.parse(raw) as StoredAdSession;
            if (stored.id && now - stored.lastUsedAt < AD_SESSION_IDLE_MS && now - stored.createdAt < AD_SESSION_MAX_MS) {
                localStorage.setItem(key, JSON.stringify({ ...stored, lastUsedAt: now }));
                return stored.id;
            }
        }
    } catch { }

    const fresh: StoredAdSession = { id: createUuid(), createdAt: now, lastUsedAt: now };
    try { localStorage.setItem(key, JSON.stringify(fresh)); } catch { }
    return fresh.id;
}

export function getAdSessionId(): string {
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

export function isLocallyClaimed(id: string): boolean {
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
    return decision.creative?.creative_type ?? decision.creative?.type ?? decision.ad_identifiers?.creative_type;
}

export function getBountyContent(decision: AdDecision): BountyCreativeContent | undefined {
    return decision.creative?.creative_content;
}

export async function fetchBounties(): Promise<LoadResult> {
    clearLegacyGlobalState();

    // Mirror Discord mobile's BountyActionCreators request as closely as the
    // desktop client allows: placement 4, five decisions, an account-scoped ad
    // session, the real heartbeat session, and the current connection type.
    const clientAdSessionId = getAdSessionId();
    const clientHeartbeatSessionId = await getHeartbeatSessionId();
    const connectionType = getConnectionType();

    const query: Record<string, string | number> = {
        placement: QUEST_HOME_MOBILE_CAROUSEL_PLACEMENT,
        num_decisions_requested: MAX_DECISIONS,
        client_ad_session_id: clientAdSessionId
    };

    if (clientHeartbeatSessionId) {
        query.client_heartbeat_session_id = clientHeartbeatSessionId;
    }

    const request: any = {
        url: "/quests/get-decisions",
        query
    };

    if (connectionType != null) {
        request.context = { connection_type: connectionType };
    }

    const response = await (RestAPI.get as any)(request);
    const body = (response?.body ?? {}) as DecisionsResponse;
    const decisions = Array.isArray(body.decisions) ? body.decisions : [];

    // Do not suppress server-returned creatives based on local history. The
    // server is authoritative for what is currently deliverable; local state is
    // only used for progress/claim UX after a Bounty is shown.
    const bounties = decisions.filter(decision => {
        const content = getBountyContent(decision);
        return getCreativeType(decision) === BOUNTY_CREATIVE_TYPE && content != null;
    });

    console.info("[DesktopBounties] scan result", {
        userId: currentUserId(),
        placement: QUEST_HOME_MOBILE_CAROUSEL_PLACEMENT,
        requested: MAX_DECISIONS,
        returned: decisions.length,
        bounties: bounties.length,
        hasHeartbeatSession: Boolean(clientHeartbeatSessionId),
        connectionType,
        decisions: decisions.map((decision, index) => ({
            index,
            type: getCreativeType(decision) ?? null,
            creativeId: getBountyContent(decision)?.id
                ?? decision.ad_identifiers?.creative_id
                ?? decision.ad_identifiers?.ad_content_id
                ?? null,
            hasCreative: decision.creative != null
        }))
    });

    return {
        requestId: body.request_id,
        decisions,
        bounties,
        clientAdSessionId,
        clientHeartbeatSessionId
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
    const clientHeartbeatSessionId = await getHeartbeatSessionId();

    if (clientHeartbeatSessionId) body.client_heartbeat_session_id = clientHeartbeatSessionId;
    if (decision.metadata_sealed) body.decision_metadata_sealed = decision.metadata_sealed;
    if (decision.traffic_metadata_sealed) body.traffic_metadata_sealed = decision.traffic_metadata_sealed;

    await RestAPI.post({
        url: `/quests/creatives/${content.id}/claim-reward`,
        body
    });

    rememberClaimed(content.id);
}

export function isBountiesRoute(): boolean {
    return location.pathname === "/quest-home"
        && new URLSearchParams(location.search).get(BOUNTIES_ROUTE_PARAM) === "1";
}

export function openBountiesPage() {
    NavigationRouter.transitionTo(BOUNTIES_ROUTE);
}
