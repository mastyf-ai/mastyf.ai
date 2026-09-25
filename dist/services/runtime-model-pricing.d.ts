export type PricingSource = 'cline' | 'cursor' | 'env' | 'message' | 'litellm' | 'unknown';
export interface ResolvedModelPricing {
    modelId: string;
    displayName: string;
    inputPerM: number;
    outputPerM: number;
    source: PricingSource;
    isLive: boolean;
}
export interface CallCostResult {
    costUsd: number;
    model?: string;
    displayName?: string;
    source: PricingSource;
    priced: boolean;
}
export declare class RuntimeModelPricing {
    private pricingClient;
    private cached;
    private lastRefresh;
    getActivePricing(): Promise<ResolvedModelPricing | null>;
    extractModelFromMessage(msg: unknown): string | null;
    /** Map agent or client name to appropriate model */
    resolveAgentModel(agentOrClientName?: string | null): string | null;
    resolveForMessage(msg?: unknown, clientOrServer?: string): Promise<ResolvedModelPricing | null>;
    resolveModelId(modelId: string): Promise<ResolvedModelPricing | null>;
    /** Resolve rates for a model without calling getActivePricing (avoids detectActivePricing ↔ resolve recursion). */
    private resolveModelIdDirect;
    computeCost(inputTokens: number, outputTokens: number, pricing: ResolvedModelPricing | null): CallCostResult;
    computeCostForCall(inputTokens: number, outputTokens: number, msg?: unknown, clientOrServer?: string): Promise<CallCostResult>;
    private readClineModelIdOnly;
    private detectActivePricing;
    private readClinePricing;
    private modelsMatch;
}
export declare function getRuntimeModelPricing(): RuntimeModelPricing;
//# sourceMappingURL=runtime-model-pricing.d.ts.map