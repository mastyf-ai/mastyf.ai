import type { Issue, ToolDefinition } from "./types.js";
export interface SemanticScanOptions {
    apiKey?: string;
    model?: string;
    alwaysRun?: boolean;
    onlyOnHits?: boolean;
    timeoutMs?: number;
    temperature?: number;
    /** Parent scan budget — aborts in-flight LLM fetch on timeout (M-002). */
    abortSignal?: AbortSignal;
}
/** Strip API keys and truncate LLM error bodies before logging or surfacing. */
export declare function sanitizeLlmErrorBody(body: string, secrets?: string[]): string;
export declare function runSemanticScan(tool: ToolDefinition, priorIssues: Issue[], options?: SemanticScanOptions): Promise<Issue[]>;
//# sourceMappingURL=semantic-scanner.d.ts.map