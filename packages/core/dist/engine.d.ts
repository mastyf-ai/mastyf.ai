import type { ToolDefinition, ToolScanResult, Issue, ServerScanResult } from "./types.js";
import { type SemanticScanOptions } from "./semantic-scanner.js";
export interface ScanEngineOptions {
    /** Abort in-flight semantic scans when the parent budget times out (M-002). */
    abortSignal?: AbortSignal;
    /** TR39 confusables before offline regex (default: true). */
    unicodeStrict?: boolean;
    semantic?: SemanticScanOptions & {
        onlyOnHits?: boolean;
        confidenceThreshold?: number;
    };
    /** Optional tenant id for per-tenant semantic queue caps */
    tenantId?: string;
    skipRegex?: boolean;
    skipSchema?: boolean;
    skipSemantic?: boolean;
}
/** @internal */
export declare function resetScanConcurrencyCacheForTests(): void;
/** @internal Test hook */
export { resolveScanToolTimeoutMs } from "./scan-timeouts.js";
export declare function scanTool(tool: ToolDefinition, options?: ScanEngineOptions): Promise<ToolScanResult>;
export interface ToolCallScanResult extends ToolScanResult {
    argumentIssues: Issue[];
}
/**
 * Full tool-call evaluation — scans both the tool definition (descriptions,
 * schemas, semantics) AND runtime arguments for SQL/NoSQL injection,
 * boundary evasion, credential leaks, and shell obfuscation.
 *
 * Use scanTool() for server registration-time scanning (definitions only).
 * Use scanToolCall() for runtime call-time evaluation (definitions + args).
 */
export declare function scanToolCall(tool: ToolDefinition, args?: Record<string, unknown>, options?: ScanEngineOptions): Promise<ToolCallScanResult>;
export { runArgumentScan } from "./argument-scanner.js";
export declare function scanServer(serverName: string, tools: ToolDefinition[], transport?: "stdio" | "http" | "sse", options?: ScanEngineOptions): Promise<ServerScanResult>;
//# sourceMappingURL=engine.d.ts.map