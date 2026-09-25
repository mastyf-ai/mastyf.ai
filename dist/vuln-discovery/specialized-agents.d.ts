import { type ToolDef } from './mcp-tool-fuzzer.js';
import type { McpFuzzTransport } from './mcp-fuzz-runner.js';
import type { VulnFinding } from './types.js';
export interface CoveragePlan {
    serverToolKeys: string[];
    reason: string;
}
/** Rank tools for next fuzz batch from live traffic hotness. */
export declare function coverageAgent(limit?: number): CoveragePlan;
export interface DifferentialResult {
    findingId?: string;
    promote: boolean;
    detail: string;
}
/**
 * Compare benign vs malicious twin call; promote only when malicious shows
 * exploit effect and benign does not.
 */
export declare function differentialAgent(opts: {
    serverName: string;
    tool: ToolDef;
    transport: McpFuzzTransport;
    maliciousArgs: Record<string, unknown>;
    benignArgs: Record<string, unknown>;
}): Promise<DifferentialResult>;
/** Rank novel candidates for Repro/LLM spend (HIGH+ first, then by scanner priority). */
export declare function prioritizerAgent(limit?: number): VulnFinding[];
/** Sample benign defaults from schema for differential. */
export declare function benignArgsFromTool(tool: ToolDef): Record<string, unknown>;
//# sourceMappingURL=specialized-agents.d.ts.map