/** Record USD spend after a persisted call (proxy hot path). */
export declare function recordTenantDailySpend(tenantId: string | undefined, costUsd: number): void;
export declare function getEstimatedSemanticCostUsd(): number;
/** Legacy projected check (non-atomic). Prefer tryReserveTenantDailyBudget. */
export declare function isTenantDailyBudgetExceeded(tenantId?: string, additionalUsd?: number): {
    exceeded: boolean;
    spentUsd: number;
    capUsd: number;
};
/**
 * Atomically reserve daily budget before forwarding LLM / tool work.
 * Returns false when cap would be exceeded (TOCTOU-safe with Redis when configured).
 */
export declare function tryReserveTenantDailyBudget(tenantId: string | undefined, costUsd: number): Promise<boolean>;
/** @internal tests */
export declare function resetTenantBudgetCacheForTests(): void;
//# sourceMappingURL=tenant-budget.d.ts.map