import type { ToolDefinition } from "../types.js";
export interface StdioServerConfig {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    /** Overall timeout for the entire fetch operation (default: 30_000ms) */
    timeoutMs?: number;
    /** Time to wait after initialize before sending tools/list (default: 3000ms) */
    initWaitMs?: number;
    /** Time to wait after tools/list for the response (default: 5000ms) */
    toolsListWaitMs?: number;
    /** Number of retries on transient failures (default: 1) */
    maxRetries?: number;
}
export declare function fetchToolsFromStdio(config: StdioServerConfig): Promise<ToolDefinition[]>;
//# sourceMappingURL=stdio.d.ts.map