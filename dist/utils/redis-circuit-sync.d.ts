import type { CircuitState } from './circuit-breaker.js';
export type CircuitRedisSnapshot = {
    state: CircuitState;
    failureCount: number;
    openedAt: number;
};
export declare function subscribeCircuitRedisUpdates(key: string, onUpdate: (snap: CircuitRedisSnapshot) => void): () => void;
export declare function loadCircuitFromRedis(key: string): Promise<CircuitRedisSnapshot | null>;
export declare function saveCircuitToRedis(key: string, snap: CircuitRedisSnapshot): Promise<void>;
/** @internal */
export declare function resetCircuitRedisSyncForTests(): void;
//# sourceMappingURL=redis-circuit-sync.d.ts.map