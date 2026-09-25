/**
 * Vuln Discovery Engine — orchestrates supply-chain, SAST, fuzz classification,
 * upstream probes, behavioral scoring, validation, and LLM analysis.
 */
import type { McpServerConfig } from '../types.js';
import { isVulnDiscoveryEnabled } from './auth.js';
import { validateFinding } from './validate.js';
import { analyzeFinding } from './vuln-analyst.js';
import { listFindings } from './store.js';
import type { VulnDiscoveryRunSummary, VulnFinding, AgentStackGraph } from './types.js';
export interface VulnDiscoveryRunOptions {
    servers: McpServerConfig[];
    skipAudit?: boolean;
    skipSast?: boolean;
    skipUpstream?: boolean;
    /** Skip live MCP tool fuzz (novel/runtime path). */
    skipFuzz?: boolean;
    /** When true, only run supply-chain + SBOM (CI/scout fast path). */
    supplyChainOnly?: boolean;
    /** Explicitly enable MCP tool fuzz (also implied when not supplyChainOnly unless skipFuzz). */
    mcpFuzz?: boolean;
    /** Fuzz via server.url / proxy HTTP instead of stdio spawn. */
    viaProxy?: boolean;
    upstreamUrls?: string[];
    toolsByServer?: Record<string, string[]>;
    autoValidate?: boolean;
    autoAnalyze?: boolean;
}
export interface VulnDiscoveryRunResult {
    summary: VulnDiscoveryRunSummary;
    findings: VulnFinding[];
    graph: AgentStackGraph;
}
export declare function runVulnDiscovery(opts: VulnDiscoveryRunOptions): Promise<VulnDiscoveryRunResult>;
export { listFindings, validateFinding, analyzeFinding, isVulnDiscoveryEnabled, };
//# sourceMappingURL=engine.d.ts.map