/**
 * Perimeter honesty helpers — never claim empty history as “no blocks”
 * when the live gateway ledger has stops.
 * Keep in sync with deploy/dashboard-spa/.../perimeterHonesty.ts
 */
export type DataSource = 'live-gateway' | 'history-db' | 'unavailable' | 'simulated';
export declare function normalizeDataSource(raw: string | null | undefined): DataSource;
export declare function kpiEmptyMessage(source: DataSource): string;
export declare function isContradictingEmptyAggregate(params: {
    ledgerBlocked: number;
    historyTotalRequests: number;
}): boolean;
export declare function blockedKpiSecondary(params: {
    historyBlocked: number;
    ledgerBlocked: number;
    historyTotalRequests: number;
}): string;
export declare function labelMetricSource(source: DataSource): string;
export declare function preferLivePrimary(params: {
    liveOnline: boolean;
    historyEmpty: boolean;
    liveSignal: number;
}): boolean;
/** Probe / harness receipt ids must not be sold as customer traffic. */
export declare function isHarnessReceiptId(id: string | null | undefined): boolean;
//# sourceMappingURL=perimeter-honesty.d.ts.map