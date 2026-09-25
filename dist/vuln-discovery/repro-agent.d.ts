import { type ValidationResult } from './validate.js';
import type { McpFuzzTransport } from './mcp-fuzz-runner.js';
export interface ReproResult {
    findingId: string;
    success: boolean;
    detail: string;
    validation?: ValidationResult;
}
/**
 * Confirm a single finding. If transport provided, re-call tool with stored payload.
 */
export declare function reproFinding(findingId: string, opts?: {
    transport?: McpFuzzTransport;
    toolName?: string;
}): Promise<ReproResult>;
/** Run ReproAgent over HIGH+ novel-runtime candidates. */
export declare function reproNovelCandidates(opts?: {
    transport?: McpFuzzTransport;
    limit?: number;
}): Promise<ReproResult[]>;
//# sourceMappingURL=repro-agent.d.ts.map