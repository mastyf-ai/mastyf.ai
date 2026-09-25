import type { VulnFinding } from './types.js';
export interface JsonSchemaLike {
    type?: string | string[];
    properties?: Record<string, JsonSchemaLike>;
    required?: string[];
    items?: JsonSchemaLike;
    enum?: unknown[];
}
export interface ToolDef {
    name: string;
    description?: string;
    inputSchema?: JsonSchemaLike;
}
export type FuzzDepth = 'shallow' | 'medium' | 'deep';
/** Generate mutated argument objects for a tool schema. */
export declare function generateFuzzPayloads(schema: JsonSchemaLike | undefined, depth?: FuzzDepth): Record<string, unknown>[];
export interface FuzzCallResult {
    toolName: string;
    args: Record<string, unknown>;
    ok: boolean;
    blockedByProxy: boolean;
    upstreamError?: string;
    crashed?: boolean;
    durationMs: number;
    responseExcerpt?: string;
}
/**
 * Classify a fuzz call outcome into optional VulnFinding.
 * Requires proven exploit effect (not soft-deny / args-echo).
 */
export declare function findingFromFuzzResult(serverName: string, result: FuzzCallResult): VulnFinding | null;
export { isMaliciousArgs } from './effect-classifier.js';
export declare function getFuzzDepthFromEnv(): FuzzDepth;
//# sourceMappingURL=mcp-tool-fuzzer.d.ts.map