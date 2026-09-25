import { getSharedRedisRateLimiter } from '../utils/redis-rate-limiter.js';
import { isRedisConfigured } from '../utils/redis-client.js';
const DEFAULT_MAX = 120;
const WINDOW_MS = 60_000;
function maxPerMinute() {
    const raw = process.env['MASTYF_AI_HTTP_CLIENT_RATE_LIMIT_MAX'];
    if (!raw)
        return DEFAULT_MAX;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX;
}
/** Per-client rate limit keyed by agent sub + tool (legacy HTTP proxy parity with stdio). */
export async function checkHttpClientRateLimit(clientKey, toolName, tenantId) {
    if (!isRedisConfigured()) {
        if (process.env['MASTYF_AI_GLOBAL_RATE_LIMIT_REQUIRED'] === 'true') {
            return { allowed: false, reason: 'Rate limit backend unavailable' };
        }
        return { allowed: true };
    }
    const key = `client:${clientKey || 'anonymous'}:tool:${toolName}`;
    const rl = getSharedRedisRateLimiter();
    const result = await rl.checkAndIncrement(key, maxPerMinute(), WINDOW_MS, tenantId);
    if (!result.allowed) {
        return { allowed: false, reason: `Client rate limit exceeded (${maxPerMinute()}/min)` };
    }
    return { allowed: true };
}
//# sourceMappingURL=client-rate-limit.js.map