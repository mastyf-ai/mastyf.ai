import { LRUCache } from 'lru-cache';
const sessionRateLimits = new LRUCache({
    max: 10000,
    ttl: 60 * 1000,
    updateAgeOnGet: false,
});
function rateLimitKey(opts) {
    const base = `session:${opts.sessionId}`;
    return opts.toolName ? `${base}:tool:${opts.toolName}` : base;
}
export function checkSessionRateLimit(opts) {
    const key = rateLimitKey(opts);
    const now = Date.now();
    const state = sessionRateLimits.get(key);
    if (!state || now - state.windowStart > 60_000) {
        sessionRateLimits.set(key, { count: 1, windowStart: now });
        return { allowed: true, current: 1, remaining: opts.maxCallsPerMinute - 1 };
    }
    state.count++;
    if (state.count > opts.maxCallsPerMinute) {
        return { allowed: false, current: state.count, remaining: 0 };
    }
    return { allowed: true, current: state.count, remaining: opts.maxCallsPerMinute - state.count };
}
export function createSessionRateLimitHook(maxCallsPerMinute = 120) {
    return {
        name: 'session-rate-limit',
        priority: 30,
        async beforeToolCall(context) {
            const sessionId = context.tool?.serverName || context.identity?.sub || 'unknown';
            const toolName = context.tool?.toolName;
            const check = checkSessionRateLimit({ maxCallsPerMinute, sessionId, toolName });
            if (!check.allowed) {
                return {
                    allowed: false,
                    reason: `Session rate limit exceeded: ${check.current}/${maxCallsPerMinute} calls per minute for ${toolName || 'all tools'}`,
                };
            }
            return { allowed: true };
        },
    };
}
//# sourceMappingURL=session-rate-limit.js.map