/** Shared shapes for dashboard APIs — no synthetic metrics when live data is missing. */
export type LiveDataEnvelope<T> = T & {
    available: boolean;
    error?: string;
};
export declare function unavailable<T extends Record<string, unknown>>(partial: T, error: string): LiveDataEnvelope<T>;
export declare function available<T extends Record<string, unknown>>(data: T): LiveDataEnvelope<T>;
export declare function isDemoThreatId(id: string): boolean;
export declare function defaultPolicyPath(): string;
export declare function parseCostBudgetUsd(): number | null;
//# sourceMappingURL=dashboard-live-data.d.ts.map