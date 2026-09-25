/**
 * Per-tenant rate limit for semantic LLM API calls (count + optional USD/min cap).
 */
import { Counter } from 'prom-client';
export declare const semanticAuditSkippedTotal: Counter<"reason" | "tenant_id">;
export declare function getAsyncMaxPerMin(): number;
export declare function reportSemanticAuditSkipped(reason: string, tenantId?: string): void;
export declare function getSemanticLlmMaxUsdPerMin(opts?: {
    async?: boolean;
}): number;
export declare function getAsyncMaxUsdPerMin(): number;
export declare function allowSemanticLlmCall(tenantId?: string, opts?: {
    async?: boolean;
}): Promise<boolean>;
/** @internal */
export declare function resetSemanticLlmRateLimitForTests(): void;
//# sourceMappingURL=semantic-llm-rate-limit.d.ts.map