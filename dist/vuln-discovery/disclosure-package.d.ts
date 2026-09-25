import type { VulnAnalysisReport, VulnFinding } from './types.js';
export type DisclosureCveStatus = 'none' | 'linked';
export interface DisclosurePackage {
    findingId: string;
    vendorReady: boolean;
    preview: boolean;
    cveStatus: DisclosureCveStatus;
    /** Only set when already present on the finding — never invented. */
    relatedCve?: string;
    finding: VulnFinding;
    report: VulnAnalysisReport;
    evidence: {
        reproSteps: string[];
        payloads?: unknown[];
        request?: unknown;
        response?: unknown;
        scanner: string;
        rule?: string;
        proxyDecision?: string;
        stackTrace?: string;
    };
    citations: VulnAnalysisReport['citations'];
    vendorSummary: {
        executiveSummary: string;
        disclosureGuidance: string;
        estimatedSeverity: string;
    };
    policyHint?: string;
    acceptedPolicyRuleId?: string;
    corpusFixtureId?: string;
    threatLabCandidateId?: string;
    paths: {
        dir: string;
        reportMd: string;
        reportJson: string;
        packageJson: string;
        readme: string;
        zip?: string;
    };
    builtAt: string;
}
/** Minimal ZIP (store method) for disclosure export — no external deps. */
export declare function zipStoreFiles(files: Array<{
    name: string;
    data: Buffer | string;
}>): Buffer;
/**
 * Build (or rebuild) disclosure package from finding + analysis report on disk.
 * Requires an analysis report; use prepareDisclosurePackage to analyze first.
 */
export declare function buildDisclosurePackage(findingId: string, opts?: {
    requireFinal?: boolean;
}): Promise<DisclosurePackage>;
/**
 * Ensure 3-pass analysis exists, then build disclosure package.
 * Preview allowed without approve; vendorReady requires final (approved) report.
 */
export declare function prepareDisclosurePackage(findingId: string, opts?: {
    forceAnalyze?: boolean;
}): Promise<DisclosurePackage>;
export declare function readDisclosurePackageZip(findingId: string): Buffer | null;
export declare function loadDisclosurePackageMeta(findingId: string): DisclosurePackage | null;
//# sourceMappingURL=disclosure-package.d.ts.map