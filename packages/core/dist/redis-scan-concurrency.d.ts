export declare function isRedisScanConcurrencyEnabled(): boolean;
export declare function tryAcquireScanSlot(max: number): Promise<boolean>;
export declare function releaseScanSlot(): Promise<void>;
/** @internal */
export declare function resetRedisScanConcurrencyForTests(): void;
//# sourceMappingURL=redis-scan-concurrency.d.ts.map