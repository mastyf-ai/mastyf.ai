export declare function isRedisConfigured(): boolean;
export declare function isRedisSemanticQueueEnabled(): boolean;
export declare function semanticQueueMax(): number;
export declare function semanticPerTenantMax(): number;
export declare function tryAcquireRedisSemanticSlot(tenantId?: string): Promise<boolean>;
export declare function releaseRedisSemanticSlot(tenantId?: string): Promise<void>;
/** @internal */
export declare function resetRedisSemanticQueueForTests(): void;
//# sourceMappingURL=redis-semantic-queue.d.ts.map