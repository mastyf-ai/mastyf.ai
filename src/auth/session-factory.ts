import { SessionCache } from './session-cache.js';
import { RedisSessionCache } from './redis-session-cache.js';
import { Logger } from '../utils/logger.js';
import { isRedisConfigured } from '../utils/redis-client.js';
import type { AgentIdentity } from './auth-types.js';

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
): Promise<AgentIdentity | null> {
  if (!cache || !token) return null;

  const local = cache.validateSession(token);
  if (local) return local;

  if (cache instanceof RedisSessionCache) {
    return cache.validateSessionAsync(token);
  }
  return null;
}
