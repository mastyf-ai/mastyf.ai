/**
 * Static + supply-chain scanner — wires CveChecker transitive deps + npm audit
 * into VulnFinding records (including pre-advisory / no-CVE audit findings).
 */
import type { McpServerConfig, CveFinding } from '../types.js';
import type { VulnFinding } from './types.js';
/** Package token appears as a product match (word boundary), not a digit substring. */
export declare function packageAppearsInCveText(pkg: string, text: string): boolean;
/**
 * NVD keyword hits are corroboration only unless OSV also reported the same id
 * or the package token is a credible product match in the summary.
 */
export declare function shouldUpsertCveFinding(pkg: string, cve: CveFinding, osvIds: Set<string>): boolean;
export interface SupplyChainScanResult {
    findings: VulnFinding[];
    cveCount: number;
    auditCount: number;
    sbomPath?: string;
    sbomDiff?: {
        added: string[];
        removed: string[];
    };
    errors: string[];
}
/**
 * Full supply-chain scan for one MCP server — OSV/NVD + transitive npm audit + SBOM.
 */
export declare function scanServerSupplyChain(server: McpServerConfig, opts?: {
    skipAudit?: boolean;
    skipTransitiveTree?: boolean;
}): Promise<SupplyChainScanResult>;
//# sourceMappingURL=supply-chain-scanner.d.ts.map