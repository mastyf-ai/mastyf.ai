import { Redis, Cluster } from 'ioredis';
export interface RedisClientOptions {
    maxRetriesPerRequest?: number;
    lazyConnect?: boolean;
    connectTimeout?: number;
    /** Override REDIS_URL for secondary clients (e.g. cross-region global rate limit). */
    connectionString?: string;
}
/** True when any Redis HA env is set (single, Sentinel, or Cluster). */
export declare function isRedisConfigured(): boolean;
/** Parse `host:port,host:port` sentinel endpoints. */
export declare function parseSentinelEndpoints(raw: string): Array<{
    host: string;
    port: number;
}>;
/** Parse `host:port,host:port` cluster node list. */
export declare function parseClusterNodes(raw: string): Array<{
    host: string;
    port: number;
}>;
export type RedisConnectionMode = 'url' | 'sentinel' | 'cluster' | 'none';
export declare function getRedisConnectionMode(): RedisConnectionMode;
export declare function getRedisConnectionLabel(): string;
/**
 * Create an ioredis client for single URL, Sentinel, or Cluster mode.
 * Priority: REDIS_CLUSTER_NODES > REDIS_SENTINELS > REDIS_URL.
 */
export declare function createRedisClient(options?: RedisClientOptions): Redis | Cluster;
/** Singleton Redis client for idempotency, block-learning locks, etc. */
export declare function getSharedRedisClient(): Redis | Cluster;
export declare function resetSharedRedisClientForTests(): void;
//# sourceMappingURL=redis-client.d.ts.map