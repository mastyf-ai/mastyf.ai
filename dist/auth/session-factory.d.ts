import { SessionCache } from './session-cache.js';
import { RedisSessionCache } from './redis-session-cache.js';
import type { SessionValidationResult } from './session-cache.js';
export type MastyfAiSessionCache = SessionCache | RedisSessionCache;
export declare function createSessionCache(): MastyfAiSessionCache;
export declare function validateSessionToken(cache: MastyfAiSessionCache | null, token: string, tenantId?: string): Promise<SessionValidationResult | null>;
//# sourceMappingURL=session-factory.d.ts.map