/**
 * Cluster-wide semantic scan concurrency caps (Redis Lua atomic INCR/DECR).
 * Used by async semantic audit and packages/core semantic queue when Redis is configured.
 */
import { Gauge } from 'prom-client';
export declare const semanticQueueBackendGauge: Gauge<"backend">;
export declare function isRedisSemanticQueueEnabled(): boolean;
export declare function semanticQueueMax(): number;
export declare function semanticPerTenantMax(): number;
export declare function tryAcquireRedisSemanticSlot(tenantId?: string): Promise<boolean>;
export declare function releaseRedisSemanticSlot(tenantId?: string): Promise<void>;
export declare function getRedisSemanticQueueDepth(): Promise<number>;
/** Warn once when process-local caps are used in enterprise/multi-replica posture. */
export declare function warnLocalSemanticQueueCapsIfNeeded(): void;
//# sourceMappingURL=redis-semantic-queue.d.ts.map