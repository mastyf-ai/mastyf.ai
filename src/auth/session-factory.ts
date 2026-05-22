import { SessionCache } from './session-cache.js';
import { RedisSessionCache } from './redis-session-cache.js';
import { Logger } from '../utils/logger.js';
import { isRedisConfigured } from '../utils/redis-client.js';
import type { SessionValidationResult } from './session-cache.js';

export type GuardianSessionCache = SessionCache | RedisSessionCache;

export function createSessionCache(): GuardianSessionCache {
  if (isRedisConfigured()) {
    Logger.info('[session-factory] Using Redis-backed session cache');
    return new RedisSessionCache();
  }
  return new SessionCache();
}

export async function validateSessionToken(
  cache: GuardianSessionCache | null,
  token: string,
  tenantId?: string,
): Promise<SessionValidationResult | null> {
  if (!cache || !token) return null;

  const local = cache.validateSessionWithRotation(token, tenantId);
  if (local) return local;

  if (cache instanceof RedisSessionCache) {
    return cache.validateSessionAsync(token, tenantId);
  }
  return null;
}
