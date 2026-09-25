import type { Redis } from 'ioredis';
/** Jittered backoff for lock contention (L-4 / H-3). */
export declare function retryDelayWithJitter(attempt: number, baseMs: number): number;
export declare function parseQuorumRedisUrls(): string[];
/**
 * Multi-Redis quorum jti claim (Redlock-style majority) for active-active regions.
 * Requires MASTYF_AI_DPOP_QUORUM_REDIS=redis://a,redis://b,redis://c
 */
export declare function claimDpopJtiQuorum(clients: Array<Pick<Redis, 'set' | 'get' | 'del'>>, keyPrefix: string, jti: string, ttlSeconds: number, tenantId: string): Promise<boolean>;
export declare function resetDpopQuorumClientsForTests(): void;
export declare function getDpopQuorumClients(): Promise<Redis[]>;
//# sourceMappingURL=dpop-quorum.d.ts.map