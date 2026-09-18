/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 danyx64
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { filters, findByPropsLazy, findStoreLazy, mapMangledModuleLazy } from "@webpack";
import { NavigationRouter, RestAPI, UserStore } from "@webpack/common";

// Resolve Discord's own enums at runtime. Numeric fallbacks are only used if
// Discord renames/removes the exported enum module.
const AdPlacement = findByPropsLazy(
    "INVALID_PLACEMENT",
    "DESKTOP_ACCOUNT_PANEL_AREA",
    "QUEST_HOME_MOBILE_CAROUSEL",
    "VIDEO_MODAL_MOBILE"
) as {
    VIDEO_MODAL_MOBILE?: number;
    [key: string | number]: string | number | undefined;
};
const AdCreativeType = findByPropsLazy(
    "INVALID",
    "QUEST",
    "QUEST_HOME_HERO",
    "BOUNTY",
    "NO_FILL"
) as {
    BOUNTY?: number;
    [key: string | number]: string | number | undefined;
};

const FALLBACK_BOUNTY_PLACEMENT = 5;
const FALLBACK_BOUNTY_CREATIVE_TYPE = 3;
const DECISION_BATCH_SIZE = 5;
export const BOUNTIES_ROUTE_PARAM = "vc_bounties";
export const BOUNTIES_ROUTE = `/quest-home?${BOUNTIES_ROUTE_PARAM}=1`;

const AD_SESSION_STORAGE_KEY = "vc-desktop-bounties-ad-session-v1";
const PROGRESS_STORAGE_KEY = "vc-desktop-bounties-progress-v1";
const LEGACY_CLAIMED_STORAGE_KEY = "vc-desktop-bounties-claimed-v1";
const AD_SESSION_IDLE_MS = 30 * 60 * 1000;
const AD_SESSION_MAX_MS = 12 * 60 * 60 * 1000;
const RECENTLY_CLAIMED_TTL_MS = 10 * 60 * 1000;

let legacyStateCleared = false;
const bountyFetchInFlightByUser = new Map<string, Promise<LoadResult>>();
const bountyCacheByUser = new Map<string, { expiresAt: number; result: LoadResult; }>();
const recentlyClaimedByUser = new Map<string, Map<string, number>>();

const DEFAULT_BOUNTY_CACHE_MS = 30_000;
const MIN_BOUNTY_CACHE_MS = 5_000;
const MAX_BOUNTY_CACHE_MS = 5 * 60_000;

const LEGACY_GLOBAL_KEYS = [
    AD_SESSION_STORAGE_KEY,
    PROGRESS_STORAGE_KEY,
    LEGACY_CLAIMED_STORAGE_KEY,
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

const NativeAdSession = mapMangledModuleLazy("future facing timestamp Date.now()", {
    getOrRefreshAdSession: filters.byCode("createdAtTimestamp", "lastUsedTimestamp", "AD_SESSION_RESET")
}) as {
    getOrRefreshAdSession?: (updateLastUsed?: boolean) => DiscordSession | null;
};

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

interface DiscordResponse<T> {
    status?: number;
    body?: T;
}

export interface LoadResult {
    userId: string;
    requestId?: string;
    decisions: AdDecision[];
    bounties: AdDecision[];
    source: "get-decisions" | "quest-decision" | "none";
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

export function getCurrentUserId(): string | null {
    return UserStore.getCurrentUser()?.id ?? null;
}

function requireCurrentUserId(): string {
    const userId = getCurrentUserId();
    if (!userId) throw new Error("No authenticated Discord user");
    return userId;
}

function assertCurrentUser(expectedUserId: string) {
    if (getCurrentUserId() !== expectedUserId) {
        throw new Error("Discord account changed while the Bounty operation was running");
    }
}

function scopedStorageKey(base: string, userId: string): string {
    return `${base}:${userId}`;
}

function clearLegacyGlobalStateOnce() {
    if (legacyStateCleared) return;
    legacyStateCleared = true;

    try {
        for (const key of LEGACY_GLOBAL_KEYS) localStorage.removeItem(key);

        // Older builds persisted claimed IDs indefinitely. They are now only
        // kept briefly in memory so Discord remains the authoritative source.
        for (let index = localStorage.length - 1; index >= 0; index--) {
            const key = localStorage.key(index);
            if (key?.startsWith(`${LEGACY_CLAIMED_STORAGE_KEY}:`)) {
                localStorage.removeItem(key);
            }
        }
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

function getFallbackAdSessionId(userId: string): string {
    const now = Date.now();
    const key = scopedStorageKey(AD_SESSION_STORAGE_KEY, userId);

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

export function getAdSessionId(userId = requireCurrentUserId()): string {
    assertCurrentUser(userId);

    try {
        const native = NativeAdSession.getOrRefreshAdSession?.();
        if (native?.uuid) return native.uuid;
    } catch (error) {
        console.warn("[DesktopBounties] Could not reuse Discord ad session", error);
    }

    return getFallbackAdSessionId(userId);
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

function readProgress(userId: string): Record<string, number> {
    try {
        return JSON.parse(localStorage.getItem(scopedStorageKey(PROGRESS_STORAGE_KEY, userId)) ?? "{}") as Record<string, number>;
    } catch {
        return {};
    }
}

export function getSavedProgress(userId: string, id: string): number {
    return Math.max(0, Number(readProgress(userId)[id]) || 0);
}

export function saveProgress(userId: string, id: string, seconds: number) {
    try {
        const all = readProgress(userId);
        all[id] = Math.max(0, seconds);
        localStorage.setItem(scopedStorageKey(PROGRESS_STORAGE_KEY, userId), JSON.stringify(all));
    } catch { }
}

function isRecentlyClaimed(userId: string, id: string): boolean {
    const claims = recentlyClaimedByUser.get(userId);
    if (!claims) return false;

    const now = Date.now();
    for (const [creativeId, claimedAt] of claims) {
        if (now - claimedAt >= RECENTLY_CLAIMED_TTL_MS) claims.delete(creativeId);
    }

    if (claims.size === 0) recentlyClaimedByUser.delete(userId);
    return claims.has(id);
}

export function rememberClaimed(userId: string, id: string) {
    let claims = recentlyClaimedByUser.get(userId);
    if (!claims) {
        claims = new Map();
        recentlyClaimedByUser.set(userId, claims);
    }
    claims.set(id, Date.now());

    try {
        const progress = readProgress(userId);
        if (id in progress) {
            delete progress[id];
            localStorage.setItem(scopedStorageKey(PROGRESS_STORAGE_KEY, userId), JSON.stringify(progress));
        }
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

function getBountyPlacement(): number {
    const placement = Number(AdPlacement.VIDEO_MODAL_MOBILE);
    return Number.isInteger(placement)
        && placement > 0
        && AdPlacement[placement] === "VIDEO_MODAL_MOBILE"
        ? placement
        : FALLBACK_BOUNTY_PLACEMENT;
}

function getBountyCreativeType(): number {
    const creativeType = Number(AdCreativeType.BOUNTY);
    return Number.isInteger(creativeType)
        && creativeType > 0
        && AdCreativeType[creativeType] === "BOUNTY"
        ? creativeType
        : FALLBACK_BOUNTY_CREATIVE_TYPE;
}

export function getBountyContent(decision: AdDecision): BountyCreativeContent | undefined {
    return decision.creative?.creative_content;
}

function filterBounties(decisions: AdDecision[], userId: string): AdDecision[] {
    const seen = new Set<string>();
    const bounties: AdDecision[] = [];

    for (const decision of decisions) {
        const content = getBountyContent(decision);
        if (
            getCreativeType(decision) !== getBountyCreativeType()
            || content?.id == null
            || isRecentlyClaimed(userId, content.id)
            || seen.has(content.id)
        ) continue;

        seen.add(content.id);
        bounties.push(decision);
    }

    return bounties;
}

function makeRequestContext(connectionType: unknown): Record<string, unknown> | undefined {
    return connectionType == null ? undefined : { connection_type: connectionType };
}

function assertSuccessfulResponse<T>(response: DiscordResponse<T>) {
    const status = Number(response.status);
    if (!Number.isFinite(status) || status < 400) return;

    const body = response.body as { message?: string; } | undefined;
    const error = new Error(body?.message || `Discord request failed with HTTP ${status}`) as Error & {
        body?: unknown;
        status?: number;
    };
    error.body = response.body;
    error.status = status;
    throw error;
}

function getBountyCacheDuration(decisions: AdDecision[]): number {
    const ttlSeconds = decisions
        .map(decision => Number(decision.response_ttl_seconds))
        .filter(ttl => Number.isFinite(ttl) && ttl > 0);

    if (ttlSeconds.length === 0) return DEFAULT_BOUNTY_CACHE_MS;

    const ttlMs = Math.min(...ttlSeconds) * 1000;
    return Math.min(MAX_BOUNTY_CACHE_MS, Math.max(MIN_BOUNTY_CACHE_MS, ttlMs));
}

// Requests intentionally use Discord's native RestAPI headers. Do not spoof
// X-Super-Properties: the same account/token should keep one consistent client
// identity across normal Discord traffic and Bounty traffic.

async function fetchQuestHomeBountyDecisions(context: RequestContext): Promise<{
    requestId?: string;
    decisions: AdDecision[];
}> {
    const query: Record<string, string | number> = {
        placement: getBountyPlacement(),
        client_ad_session_id: context.clientAdSessionId,
        num_decisions_requested: DECISION_BATCH_SIZE
    };

    if (context.clientHeartbeatSessionId) {
        query.client_heartbeat_session_id = context.clientHeartbeatSessionId;
    }

    const request: Parameters<typeof RestAPI.get>[0] & {
        context?: Record<string, unknown>;
    } = {
        url: "/quests/get-decisions",
        query
    };
    request.context = makeRequestContext(context.connectionType);

    const response = await RestAPI.get(request);
    assertSuccessfulResponse(response);
    const body = (response?.body ?? {}) as DecisionsResponse;

    return {
        requestId: body.request_id,
        decisions: Array.isArray(body.decisions) ? body.decisions : []
    };
}

async function fetchDesktopBountyDecision(context: RequestContext): Promise<{
    requestId?: string;
    decision: AdDecision | null;
}> {
    const query: Record<string, string | number> = {
        placement: getBountyPlacement(),
        client_ad_session_id: context.clientAdSessionId
    };

    if (context.clientHeartbeatSessionId) {
        query.client_heartbeat_session_id = context.clientHeartbeatSessionId;
    }

    const request: Parameters<typeof RestAPI.get>[0] & {
        context?: Record<string, unknown>;
    } = {
        url: "/quests/decision",
        query
    };
    request.context = makeRequestContext(context.connectionType);

    const response = await RestAPI.get(request);
    assertSuccessfulResponse(response);

    const body = response.body;
    if (body == null || typeof body !== "object") {
        return { decision: null };
    }

    const decision = body as AdDecision;
    return {
        requestId: decision.request_id != null ? String(decision.request_id) : undefined,
        decision
    };
}

async function performBountyFetch(userId: string): Promise<LoadResult> {
    clearLegacyGlobalStateOnce();
    assertCurrentUser(userId);

    const clientAdSessionId = getAdSessionId(userId);
    const clientHeartbeatSessionId = await getHeartbeatSessionId();
    assertCurrentUser(userId);

    const connectionType = getConnectionType();
    const context: RequestContext = {
        clientAdSessionId,
        clientHeartbeatSessionId,
        connectionType
    };

    // Primary path: the Bounty list endpoint used by Quest Home.
    const response = await fetchQuestHomeBountyDecisions(context);
    assertCurrentUser(userId);

    const bounties = filterBounties(response.decisions, userId);
    if (bounties.length > 0) {
        return {
            userId,
            requestId: response.requestId,
            decisions: response.decisions,
            bounties,
            source: "get-decisions"
        };
    }

    // Safe fallback: current desktop Discord also supports BOUNTY creatives on
    // /quests/decision. This keeps the same native client identity and only runs
    // when the list endpoint did not return a Bounty.
    const fallback = await fetchDesktopBountyDecision(context);
    assertCurrentUser(userId);

    const fallbackDecisions = fallback.decision ? [fallback.decision] : [];
    const fallbackBounties = filterBounties(fallbackDecisions, userId);

    return {
        userId,
        requestId: fallback.requestId ?? response.requestId,
        decisions: fallbackBounties.length > 0 ? fallbackDecisions : response.decisions,
        bounties: fallbackBounties,
        source: fallbackBounties.length > 0 ? "quest-decision" : "none"
    };
}

export function invalidateBountyCache(userId: string) {
    bountyCacheByUser.delete(userId);
}

function refreshFilteredResult(result: LoadResult, userId: string): LoadResult {
    const bounties = filterBounties(result.decisions, userId);
    const unchanged = bounties.length === result.bounties.length
        && bounties.every((decision, index) =>
            getBountyContent(decision)?.id === getBountyContent(result.bounties[index])?.id
        );

    if (unchanged) return result;

    return {
        ...result,
        bounties,
        source: bounties.length > 0 ? result.source : "none"
    };
}

export function fetchBounties(userId: string, force = false): Promise<LoadResult> {
    assertCurrentUser(userId);

    if (!force) {
        const cached = bountyCacheByUser.get(userId);
        if (cached && cached.expiresAt > Date.now()) {
            const fresh = refreshFilteredResult(cached.result, userId);
            if (fresh !== cached.result) cached.result = fresh;
            return Promise.resolve(fresh);
        }
    }

    const existing = bountyFetchInFlightByUser.get(userId);
    if (existing) return existing.then(result => refreshFilteredResult(result, userId));

    const request = performBountyFetch(userId)
        .then(result => {
            const fresh = refreshFilteredResult(result, userId);
            bountyCacheByUser.set(userId, {
                expiresAt: Date.now() + getBountyCacheDuration(fresh.decisions),
                result: fresh
            });
            return fresh;
        })
        .finally(() => {
            if (bountyFetchInFlightByUser.get(userId) === request) {
                bountyFetchInFlightByUser.delete(userId);
            }
        });

    bountyFetchInFlightByUser.set(userId, request);
    return request;
}

export async function claimBounty(decision: AdDecision, userId: string) {
    assertCurrentUser(userId);

    const content = getBountyContent(decision);
    if (!content?.id) throw new Error("Missing Bounty creative ID");

    // Discord mobile refreshes/reuses the native ad session at claim time.
    const clientAdSessionId = getAdSessionId(userId);
    const clientHeartbeatSessionId = await getHeartbeatSessionId();
    assertCurrentUser(userId);

    const body: Record<string, string | null> = {
        decision_metadata_sealed: decision.metadata_sealed ?? null,
        traffic_metadata_sealed: decision.traffic_metadata_sealed ?? null,
        client_ad_session_id: clientAdSessionId,
        client_heartbeat_session_id: clientHeartbeatSessionId ?? null
    };

    const response = await RestAPI.post({
        url: `/quests/creatives/${content.id}/claim-reward`,
        body
    });
    assertSuccessfulResponse(response);

    rememberClaimed(userId, content.id);
    invalidateBountyCache(userId);
}

export function isBountiesRoute(): boolean {
    return location.pathname === "/quest-home"
        && new URLSearchParams(location.search).get(BOUNTIES_ROUTE_PARAM) === "1";
}

export function openBountiesPage() {
    NavigationRouter.transitionTo(BOUNTIES_ROUTE);
}
