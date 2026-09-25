/**
 * Unified cross-provider spend pool — tokens/min, USD/min, USD/day (atomic Redis Lua + in-process fallback).
 *
 * All proxied tool traffic (any upstream model/provider) debits the same tenant pool.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDailyBudgetCapUsd } from './cost-auditor.js';
import { Logger } from '../utils/logger.js';
import { isRedisConfigured, getSharedRedisClient } from '../utils/redis-client.js';
import * as Metrics from '../utils/metrics.js';
const REDIS_DAY_PREFIX = 'mastyf_ai:unified_spend:day:';
const REDIS_TOKENS_MIN_PREFIX = 'mastyf_ai:unified_spend:tokens_min:';
const REDIS_USD_MIN_PREFIX = 'mastyf_ai:unified_spend:usd_min:';
const __dirname = dirname(fileURLToPath(import.meta.url));
function loadLuaScript(name) {
    const candidates = [
        join(__dirname, '../../scripts/redis', name),
        join(process.cwd(), 'scripts/redis', name),
        join(process.cwd(), 'dist/scripts/redis', name),
    ];
    for (const path of candidates) {
        try {
            return readFileSync(path, 'utf-8');
        }
        catch {
            // try next
        }
    }
    throw new Error(`[unified-spend-pool] Lua script not found: ${name}`);
}
let acquireScript = null;
let releaseScript = null;
let commitScript = null;
function getAcquireScript() {
    acquireScript ??= loadLuaScript('unified-spend-acquire.lua');
    return acquireScript;
}
function getReleaseScript() {
    releaseScript ??= loadLuaScript('unified-spend-release.lua');
    return releaseScript;
}
function getCommitScript() {
    commitScript ??= loadLuaScript('unified-spend-commit.lua');
    return commitScript;
}
const localReservations = new Map();
function utcDayKey() {
    return new Date().toISOString().slice(0, 10);
}
function ttlSecondsUntilUtcMidnight() {
    const now = new Date();
    const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return Math.max(60, Math.ceil((tomorrow.getTime() - now.getTime()) / 1000));
}
function getTokensPerMinCap() {
    const n = parseInt(process.env['MASTYF_AI_TENANT_TOKENS_PER_MIN'] || '500000', 10);
    return Number.isFinite(n) && n > 0 ? n : 500_000;
}
function getUsdPerMinCap(tenantId) {
    const raw = process.env['MASTYF_AI_TENANT_USD_PER_MIN'];
    if (raw) {
        const n = parseFloat(raw);
        if (Number.isFinite(n) && n > 0)
            return n;
    }
    const perTenant = process.env['MASTYF_AI_TENANT_USD_PER_MIN_JSON'];
    if (perTenant) {
        try {
            const map = JSON.parse(perTenant);
            const v = map[tenantId];
            if (typeof v === 'number' && v > 0)
                return v;
        }
        catch {
            // ignore
        }
    }
    return 0;
}
function isEnterpriseSpendStrict() {
    return process.env['MASTYF_AI_ENTERPRISE_MODE'] === 'true'
        || process.env['MASTYF_AI_STRICT_MODE'] === 'true';
}
function dayKey(tenantId) {
    return `${REDIS_DAY_PREFIX}${utcDayKey()}:${tenantId}`;
}
function tokensMinKey(tenantId, sessionKey) {
    const suffix = sessionKey ? `${tenantId}:${sessionKey}` : tenantId;
    return `${REDIS_TOKENS_MIN_PREFIX}${suffix}`;
}
function usdMinKey(tenantId) {
    return `${REDIS_USD_MIN_PREFIX}${tenantId}`;
}
const localDaySpend = new Map();
const localTokensMin = new Map();
const localUsdMin = new Map();
function buildSpendWindows(tid, sessionKey, tokens, usdMicro, tokensCap, usdMinCap, dayCap) {
    const windows = [];
    if (tokens > 0 && tokensCap > 0) {
        windows.push({
            key: tokensMinKey(tid, sessionKey),
            cap: tokensCap,
            ttl: 60,
            delta: tokens,
        });
    }
    if (usdMicro > 0 && usdMinCap > 0) {
        windows.push({
            key: usdMinKey(tid),
            cap: Math.ceil(usdMinCap * 1_000_000),
            ttl: 60,
            delta: usdMicro,
        });
    }
    if (usdMicro > 0 && dayCap > 0) {
        windows.push({
            key: dayKey(tid),
            cap: Math.ceil(dayCap * 1_000_000),
            ttl: ttlSecondsUntilUtcMidnight(),
            delta: usdMicro,
        });
    }
    return windows;
}
function localReserve(reservationId, tid, tokens, usdMicro, windows) {
    const now = Date.now();
    const applied = [];
    for (const w of windows) {
        if (w.key.startsWith(REDIS_TOKENS_MIN_PREFIX)) {
            let b = localTokensMin.get(w.key);
            if (!b || now >= b.resetAt)
                b = { count: 0, resetAt: now + 60_000 };
            if (b.count + w.delta > w.cap) {
                void releaseReservedSpend(reservationId);
                return { ok: false, rule: 'token-budget-per-minute', reason: 'Tenant tokens per minute exceeded' };
            }
            b.count += w.delta;
            localTokensMin.set(w.key, b);
            applied.push({ key: w.key, delta: w.delta, kind: 'tokens' });
        }
        else if (w.key.startsWith(REDIS_USD_MIN_PREFIX)) {
            let b = localUsdMin.get(w.key);
            if (!b || now >= b.resetAt)
                b = { usd: 0, resetAt: now + 60_000 };
            const deltaUsd = w.delta / 1_000_000;
            const capUsd = w.cap / 1_000_000;
            if (b.usd + deltaUsd > capUsd) {
                void releaseReservedSpend(reservationId);
                return { ok: false, rule: 'usd-budget-per-minute', reason: 'Tenant USD per minute exceeded' };
            }
            b.usd += deltaUsd;
            localUsdMin.set(w.key, b);
            applied.push({ key: w.key, delta: w.delta, kind: 'usd' });
        }
        else if (w.key.startsWith(REDIS_DAY_PREFIX)) {
            const dk = `${utcDayKey()}:${tid}`;
            const spent = localDaySpend.get(dk) ?? 0;
            const deltaUsd = w.delta / 1_000_000;
            const capUsd = w.cap / 1_000_000;
            if (spent + deltaUsd > capUsd) {
                void releaseReservedSpend(reservationId);
                return { ok: false, rule: 'unified-spend-pool', reason: 'Tenant daily USD cap exceeded' };
            }
            localDaySpend.set(dk, spent + deltaUsd);
            applied.push({ key: w.key, delta: w.delta, kind: 'usd' });
        }
    }
    localReservations.set(reservationId, {
        tenantId: tid,
        tokens,
        usdMicro,
        windows: applied,
    });
    refreshSpendGauges(tid, tokens);
    return { ok: true, reservationId };
}
export async function tryReserveSpend(input) {
    const tid = input.tenantId?.trim() || 'default';
    const tokens = Math.max(0, Math.floor(input.tokens || 0));
    const estimatedUsd = Math.max(0, input.estimatedUsd || 0);
    const usdMicro = Math.ceil(estimatedUsd * 1_000_000);
    const tokensCap = getTokensPerMinCap();
    const usdMinCap = getUsdPerMinCap(tid);
    const dayCap = getDailyBudgetCapUsd(tid);
    const reservationId = randomUUID();
    if (tokensCap > 0 && tokens > tokensCap) {
        return {
            ok: false,
            rule: 'unified-spend-pool',
            reason: `Single request tokens ${tokens} exceed per-minute cap ${tokensCap}`,
        };
    }
    const windows = buildSpendWindows(tid, input.sessionKey, tokens, usdMicro, tokensCap, usdMinCap, dayCap);
    if (windows.length === 0) {
        return { ok: true, reservationId };
    }
    if (isRedisConfigured()) {
        try {
            const redis = getSharedRedisClient();
            const argv = [
                reservationId,
                tokens,
                usdMicro,
                windows.length,
            ];
            for (const w of windows) {
                argv.push(w.key, w.cap, w.ttl, w.delta);
            }
            const result = await redis.eval(getAcquireScript(), 0, ...argv.map(String));
            const ok = Array.isArray(result) ? result[0] === 1 : result === 1;
            if (!ok) {
                return { ok: false, rule: 'unified-spend-pool', reason: 'Spend cap exceeded' };
            }
            refreshSpendGauges(tid, tokens);
            return { ok: true, reservationId };
        }
        catch (err) {
            if (isEnterpriseSpendStrict()) {
                Logger.error(`[unified-spend-pool] Redis reserve failed: ${err instanceof Error ? err.message : String(err)}`);
                return { ok: false, rule: 'unified-spend-pool', reason: 'Spend pool unavailable' };
            }
        }
    }
    else if (isEnterpriseSpendStrict()) {
        return { ok: false, rule: 'unified-spend-pool', reason: 'Redis required for enterprise spend enforcement' };
    }
    return localReserve(reservationId, tid, tokens, usdMicro, windows);
}
export async function releaseReservedSpend(reservationId) {
    if (!reservationId)
        return;
    if (isRedisConfigured()) {
        try {
            const redis = getSharedRedisClient();
            await redis.eval(getReleaseScript(), 0, reservationId);
        }
        catch {
            // best-effort
        }
    }
    const local = localReservations.get(reservationId);
    if (!local)
        return;
    for (const w of local.windows) {
        if (w.kind === 'tokens') {
            const b = localTokensMin.get(w.key);
            if (b) {
                b.count = Math.max(0, b.count - w.delta);
                localTokensMin.set(w.key, b);
            }
        }
        else {
            const deltaUsd = w.delta / 1_000_000;
            if (w.key.startsWith(REDIS_USD_MIN_PREFIX)) {
                const b = localUsdMin.get(w.key);
                if (b) {
                    b.usd = Math.max(0, b.usd - deltaUsd);
                    localUsdMin.set(w.key, b);
                }
            }
            else {
                const dk = `${utcDayKey()}:${local.tenantId}`;
                localDaySpend.set(dk, Math.max(0, (localDaySpend.get(dk) ?? 0) - deltaUsd));
            }
        }
    }
    localReservations.delete(reservationId);
}
export async function commitSpend(reservationId, tenantId, actualUsd) {
    if (!reservationId)
        return;
    const tid = tenantId?.trim() || 'default';
    const actualMicro = Math.ceil(Math.max(0, actualUsd) * 1_000_000);
    if (isRedisConfigured()) {
        try {
            const redis = getSharedRedisClient();
            await redis.eval(getCommitScript(), 0, reservationId, String(actualMicro), dayKey(tid), String(ttlSecondsUntilUtcMidnight()));
        }
        catch {
            // best-effort
        }
    }
    const local = localReservations.get(reservationId);
    if (local) {
        const deltaUsd = actualUsd - local.usdMicro / 1_000_000;
        if (Math.abs(deltaUsd) >= 0.000001) {
            const dk = `${utcDayKey()}:${tid}`;
            localDaySpend.set(dk, (localDaySpend.get(dk) ?? 0) + deltaUsd);
        }
        localReservations.delete(reservationId);
    }
}
/** @deprecated Use commitSpend with reservationId */
export async function recordActualSpend(tenantId, actualUsd, reservedUsd) {
    const tid = tenantId?.trim() || 'default';
    const delta = actualUsd - reservedUsd;
    if (Math.abs(delta) < 0.000001)
        return;
    if (isRedisConfigured() && delta !== 0) {
        try {
            const redis = getSharedRedisClient();
            const micro = Math.ceil(delta * 1_000_000);
            await redis.incrby(dayKey(tid), micro);
            await redis.expire(dayKey(tid), ttlSecondsUntilUtcMidnight());
        }
        catch {
            // best-effort reconcile
        }
    }
    const dk = `${utcDayKey()}:${tid}`;
    localDaySpend.set(dk, (localDaySpend.get(dk) ?? 0) + delta);
}
function refreshSpendGauges(tenantId, tokensAdded) {
    const dayCap = getDailyBudgetCapUsd(tenantId);
    const dk = `${utcDayKey()}:${tenantId}`;
    const spent = localDaySpend.get(dk) ?? 0;
    Metrics.tenantSpendUsdDayRatio.set(dayCap > 0 ? Math.min(1, spent / dayCap) : 0);
    if (tokensAdded > 0) {
        Metrics.tenantTokensPerMin.set({ tenant_id: tenantId }, tokensAdded);
    }
}
/** @internal tests */
export function resetUnifiedSpendPoolForTests() {
    localDaySpend.clear();
    localTokensMin.clear();
    localUsdMin.clear();
    localReservations.clear();
}
/**
 * Read-only spend cap status for Economics Caps panel.
 * Never invents utilization — Redis peek only when configured.
 */
export async function getSpendCapsStatus(tenantId) {
    const tid = tenantId?.trim() || 'default';
    const tokensCap = getTokensPerMinCap();
    const usdMin = getUsdPerMinCap(tid);
    const usdDay = getDailyBudgetCapUsd(tid);
    const redisOk = isRedisConfigured();
    const caps = {
        tokens_per_min: tokensCap > 0 ? tokensCap : null,
        usd_per_min: usdMin > 0 ? usdMin : null,
        usd_per_day: usdDay > 0 ? usdDay : null,
    };
    let tokensUsed = null;
    let usdDayUsed = null;
    if (redisOk) {
        try {
            const redis = getSharedRedisClient();
            const [tokRaw, dayRaw] = await Promise.all([
                redis.get(tokensMinKey(tid)),
                redis.get(dayKey(tid)),
            ]);
            if (tokRaw != null && tokRaw !== '') {
                const n = parseInt(String(tokRaw), 10);
                tokensUsed = Number.isFinite(n) ? n : null;
            }
            if (dayRaw != null && dayRaw !== '') {
                const micro = parseInt(String(dayRaw), 10);
                usdDayUsed = Number.isFinite(micro) ? micro / 1_000_000 : null;
            }
            return {
                source: 'live-spend-pool',
                redis_configured: true,
                caps,
                utilization: {
                    tokens_per_min_used: tokensUsed,
                    usd_per_day_used: usdDayUsed,
                },
                note: 'Utilization from Redis spend-pool keys; limits from env.',
            };
        }
        catch (err) {
            return {
                source: 'unavailable',
                redis_configured: true,
                caps,
                utilization: { tokens_per_min_used: null, usd_per_day_used: null },
                note: `Redis configured but unreadable: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
    return {
        source: 'unavailable',
        redis_configured: false,
        caps,
        utilization: { tokens_per_min_used: null, usd_per_day_used: null },
        note: 'Redis not configured — caps listed from env are not enforceable (enterprise spend pool requires Redis).',
    };
}
//# sourceMappingURL=unified-spend-pool.js.map