export declare const PRICING_TABLE_DATE = "2025-03-01";
export declare const PRICING_STALENESS_DAYS = 30;
export declare function getPricingStalenessWarning(): string | null;
export declare class PricingClient {
    private customPricing;
    private liveModels;
    /**
     * Sync cost estimate (per-million tokens). Third arg `true` = output pricing.
     * Uses live/custom rates when present, otherwise the last-reviewed static table.
     */
    calculateCost(tokens: number, model: string, isOutput?: boolean): number;
    getPricingForModel(model: string): {
        input: number;
        output: number;
    } | null;
    listModels(): string[];
    addPricing(model: string, inputPerMillion: number, outputPerMillion: number): void;
    /** Best-effort live refresh via signed remote URL or litellm. */
    refreshLivePricing(): Promise<void>;
    /**
     * Get live pricing for a model via litellm.
     */
    getModelPricing(model: string): Promise<{
        input: number;
        output: number;
        isLive: boolean;
    } | undefined>;
    /**
     * Fetch live pricing via litellm Python subprocess.
     * litellm has built-in pricing for 100+ models updated from provider APIs.
     */
    private fetchLivePricing;
    /**
     * Calculate cost using live pricing when available.
     */
    calculateCostAsync(model: string, inputTokens: number, outputTokens: number): Promise<{
        cost: number;
        isLive: boolean;
        priced: boolean;
    }>;
    /** Synchronous version for compatibility. Returns 0 when pricing is unavailable. */
    estimateCost(model: string, inputTokens: number, outputTokens: number): number;
    getAvailableModels(): string[];
    getPricingDate(): string;
}
//# sourceMappingURL=pricing-client.d.ts.map