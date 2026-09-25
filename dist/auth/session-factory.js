import { SessionCache } from './session-cache.js';
import { RedisSessionCache } from './redis-session-cache.js';
import { Logger } from '../utils/logger.js';
import { isRedisConfigured } from '../utils/redis-client.js';
export function createSessionCache() {
    if (isRedisConfigured()) {
        Logger.info('[session-factory] Using Redis-backed session cache');
        return new RedisSessionCache();
    }
    return new SessionCache();
}
export async function validateSessionToken(cache, token, tenantId) {
    if (!cache || !token)
        return null;
    const local = cache.validateSessionWithRotation(token, tenantId);
    if (local)
        return local;
    if (cache instanceof RedisSessionCache) {
        return cache.validateSessionAsync(token, tenantId);
    }
    return null;
}
//# sourceMappingURL=session-factory.js.map