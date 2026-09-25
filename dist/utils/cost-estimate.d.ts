import type { McpToolDefinition } from './mcp-client.js';
import { TokenCounter } from './token-counter.js';
import type { ToolCost } from '../types.js';
export interface ToolCostEstimate {
    toolName: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
}
export interface ServerCostEstimate {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    toolBreakdown: ToolCost[];
    priced: boolean;
    pricingSources: string[];
    pricingModel: string;
    modelId: string;
    provider: string;
    unpricedTools: number;
}
export interface ModelListRates {
    modelId: string;
    provider: string;
    pricingModel: string;
    inputPerM: number;
    outputPerM: number;
    inputPer1k: number;
    outputPer1k: number;
    priced: boolean;
    pricingSources: string[];
}
/** Opt-in simulated per-tool costs (tools/list footprint). Off by default since v2.7.11. */
export declare function allowsCostEstimates(): boolean;
export type CostSource = 'actual' | 'model-only' | 'estimated' | 'none';
export declare function getCostSource(): CostSource;
/** Reject misleading cost sources in production unless explicitly opted in. */
export declare function validateCostSourceAtStartup(): void;
/** Official list rates for a resolved model — no simulated call volume. */
export declare function resolveModelListRates(modelId: string): Promise<ModelListRates>;
/** Build minimal JSON arguments from JSON Schema (required fields only). */
export declare function minimalArgsFromSchema(schema?: Record<string, unknown>): Record<string, unknown>;
/**
 * Estimate per-tool MCP cost from tool definitions.
 * Requires MASTYF_AI_COST_ALLOW_ESTIMATES=true — not used by default audit path.
 */
export declare function estimateServerCostFromTools(tools: McpToolDefinition[], modelId: string, tokenCounter?: TokenCounter): Promise<ServerCostEstimate>;
//# sourceMappingURL=cost-estimate.d.ts.map