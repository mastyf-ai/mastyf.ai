import type { VulnAnalysisReport, VulnContextPack, VulnFinding, VulnSeverity } from './types.js';
export declare function isVulnAnalysisEnabled(): boolean;
export declare function buildContextPack(finding: VulnFinding): VulnContextPack;
/** Template fallback is opt-in only — LLM is mandatory by default. */
export declare function allowVulnAnalysisTemplateFallback(): boolean;
/** Ensure LLM is enabled when unset (VDE analysis requires it by default). */
export declare function ensureVulnAnalysisLlmEnabled(): void;
export declare class VulnAnalysisLlmUnavailableError extends Error {
    constructor(message: string);
}
export declare function saveReport(report: VulnAnalysisReport): string;
export declare function loadReport(findingId: string): VulnAnalysisReport | null;
/** Promote analysis report draft → final (human approve). */
export declare function approveAnalysisReport(findingId: string): VulnAnalysisReport | null;
/**
 * Multi-pass LLM analysis. LLM is mandatory by default; template only when
 * MASTYF_AI_VULN_ANALYSIS_ALLOW_TEMPLATE=true.
 */
export declare function analyzeFinding(findingId: string, opts?: {
    force?: boolean;
    passes?: number;
}): Promise<VulnAnalysisReport | null>;
export declare function analyzeAll(opts?: {
    minSeverity?: VulnSeverity;
    status?: 'validated' | 'candidate';
}): Promise<VulnAnalysisReport[]>;
/** Called when finding is validated — auto-analyze if configured. */
export declare function onFindingValidated(findingId: string): Promise<VulnAnalysisReport | null>;
//# sourceMappingURL=vuln-analyst.d.ts.map