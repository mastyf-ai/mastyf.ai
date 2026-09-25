import { Logger } from '../../utils/logger.js';
import { StructuredLogger } from '../../utils/structured-logger.js';
import { isRedisConfigured } from '../../utils/redis-client.js';
import { getSharedRedisRateLimiter } from '../../utils/redis-rate-limiter.js';
/** Cluster Redis rate limits (returns early block decision when exceeded). */
export async function evaluateRedisRateLimit(context, deps) {
    if (!isRedisConfigured()) {
        return { decision: null, skipLocalRateLimit: false };
    }
    try {
        const rl = getSharedRedisRateLimiter();
        for (const rule of deps.rules) {
            if (rule.enabled === false)
                continue;
            if (!rule.maxCallsPerMinute)
                continue;
            const tenant = context.tenantId || process.env['MASTYF_AI_TENANT_ID'] || 'default';
            const clientId = context.agentIdentity?.clientId || context.agentIdentity?.sub;
            const key = clientId
                ? `${tenant}:${context.serverName}:${context.toolName}:${clientId}:${rule.name}`
                : `${tenant}:${context.serverName}:${context.toolName}:${rule.name}`;
            const { allowed } = await rl.checkAndIncrement(key, rule.maxCallsPerMinute, 60000, tenant);
            if (!allowed) {
                return {
                    decision: {
                        action: deps.resolveAction(rule.action),
                        rule: rule.name,
                        reason: `Rate limit exceeded: ${rule.maxCallsPerMinute} calls per minute (cluster)`,
                    },
                    skipLocalRateLimit: true,
                };
            }
        }
        return { decision: null, skipLocalRateLimit: true };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        Logger.warn(`[policy] redis_rate_limit_degraded: ${message}`);
        StructuredLogger.info({
            event: 'redis_rate_limit_degraded',
            serverName: context.serverName,
            toolName: context.toolName,
            error: message,
        });
        return { decision: null, skipLocalRateLimit: false };
    }
}
//# sourceMappingURL=rate-limit-strategy.js.map