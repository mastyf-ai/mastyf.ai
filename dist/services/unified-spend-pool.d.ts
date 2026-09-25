export interface ReserveSpendInput {
    tenantId?: string;
    sessionKey?: string;
    tokens: number;
    estimatedUsd: number;
}
export interface ReserveSpendResult {
    ok: boolean;
    reservationId?: string;
    rule?: string;
    reason?: string;
}
export declare function tryReserveSpend(input: ReserveSpendInput): Promise<ReserveSpendResult>;
export declare function releaseReservedSpend(reservationId: string | undefined): Promise<void>;
export declare function commitSpend(reservationId: string | undefined, tenantId: string | undefined, actualUsd: number): Promise<void>;
/** @deprecated Use commitSpend with reservationId */
export declare function recordActualSpend(tenantId: string | undefined, actualUsd: number, reservedUsd: number): Promise<void>;
/** @internal tests */
export declare function resetUnifiedSpendPoolForTests(): void;
export type SpendCapsStatus = {
    source: 'live-spend-pool' | 'unavailable';
    redis_configured: boolean;
    caps: {
        tokens_per_min: number | null;
        usd_per_min: number | null;
        usd_per_day: number | null;
    };
    utilization: {
        tokens_per_min_used: number | null;
        usd_per_day_used: number | null;
    };
    note: string;
};
/**
 * Read-only spend cap status for Economics Caps panel.
 * Never invents utilization — Redis peek only when configured.
 */
export declare function getSpendCapsStatus(tenantId?: string): Promise<SpendCapsStatus>;
//# sourceMappingURL=unified-spend-pool.d.ts.map