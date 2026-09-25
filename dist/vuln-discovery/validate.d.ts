import type { VulnFinding } from './types.js';
export interface ValidationSignals {
    reproSuccess?: boolean;
    scannerAgreement?: boolean;
    llmConfirmation?: boolean;
}
export interface ValidationResult {
    finding: VulnFinding;
    promoted: boolean;
    signals: ValidationSignals;
    signalCount: number;
    reason: string;
}
export type DiscoveryLane = 'advisory' | 'novel-runtime' | 'other';
/**
 * Known-ecosystem dependency findings (OSV/NVD/npm audit), including
 * "Pre-advisory audit" titles that lack a CVE- id but are still published advisories.
 */
export declare function isAdvisoryDependencyFinding(finding: VulnFinding): boolean;
/** Live MCP fuzz / response / SAST / protocol signals — true novel/runtime lane. */
export declare function isRuntimeNovelFinding(finding: VulnFinding): boolean;
export declare function discoveryLane(finding: VulnFinding): DiscoveryLane;
/**
 * @deprecated Prefer isAdvisoryDependencyFinding / isRuntimeNovelFinding.
 * Kept for gates: advisory-without-CVE still needs hard promotion.
 */
export declare function isNovelOrPreAdvisory(finding: VulnFinding): boolean;
/**
 * Hard gate: require explicit llmConfirmation or live reproSuccess —
 * used for advisory-without-CVE and for runtime novel scanners.
 */
export declare function requiresHardPromotion(finding: VulnFinding): boolean;
export declare function parseCveYear(idOrTitle: string): number | undefined;
/**
 * Detect junk dependency findings (numeric package targets, ancient NVD spam)
 * and runtime false positives (soft-deny labeled as exploit).
 */
export declare function isNoiseFinding(finding: VulnFinding): {
    noise: boolean;
    reason?: string;
};
/**
 * Validate a finding. Requires 2-of-3 signals to promote to validated.
 * Deterministic signals can be derived from evidence when not provided —
 * except for novel/pre-advisory findings, which require explicit llmConfirmation
 * or an explicit live reproSuccess flag.
 */
export declare function validateFinding(id: string, signals?: ValidationSignals): ValidationResult | undefined;
export declare function rejectFinding(id: string, reason?: string): VulnFinding | undefined;
export declare function markDisclosed(id: string, externalId?: string): VulnFinding | undefined;
/** Auto-validate all HIGH/CRITICAL candidates that meet 2-of-3 deterministic signals. */
export declare function autoValidateEligible(): ValidationResult[];
export interface PurgeNoiseResult {
    rejected: number;
    skipped: number;
    deletedCaches: string[];
    reasons: Array<{
        id: string;
        reason: string;
    }>;
}
/** Delete poisoned NVD disk caches for numeric / ultra-short keyword keys. */
export declare function deletePoisonedNvdCaches(): string[];
/**
 * Batch-reject noise findings and delete poisoned numeric NVD disk caches.
 * Soft reject only (append-only store); does not hard-delete JSONL rows.
 */
export declare function purgeNoiseFindings(): PurgeNoiseResult;
//# sourceMappingURL=validate.d.ts.map