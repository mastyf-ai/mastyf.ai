/**
 * Agentic VDE orchestrator — thin multi-agent loop over existing scanners.
 *
 * Scout → Correlator → Validator → Reporter → BlockProposal
 * Never auto-applies block rules (human Accept in Threat Lab).
 */
import type { McpServerConfig } from '../types.js';
import type { VulnSeverity } from './types.js';
export interface AgenticVulnRunOptions {
    servers: McpServerConfig[];
    upstreamUrls?: string[];
    tenantId?: string;
    supplyChainOnly?: boolean;
    mcpFuzz?: boolean;
    viaProxy?: boolean;
    skipValidate?: boolean;
    skipAnalyze?: boolean;
    skipProposeBlock?: boolean;
    minSeverityForLlm?: VulnSeverity;
    useLlmForBlock?: boolean;
}
export interface AgenticVulnRunResult {
    scoutFindings: number;
    validated: number;
    rejected: number;
    reports: number;
    blockProposals: number;
    errors: string[];
    findingIds: string[];
}
/**
 * Full agentic loop. Feature flag: MASTYF_AI_VULN_AGENTIC=true (or CLI forces).
 */
export declare function runAgenticVulnDiscovery(opts: AgenticVulnRunOptions): Promise<AgenticVulnRunResult>;
/** Single-finding validate + report + propose (dashboard validate hook helper). */
export declare function agenticPromoteFinding(findingId: string, opts?: {
    tenantId?: string;
}): Promise<{
    validated: boolean;
    reason: string;
    reportId?: string;
    candidateId?: string;
}>;
//# sourceMappingURL=agentic-orchestrator.d.ts.map