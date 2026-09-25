import type { VulnFinding, VulnSeverity } from './types.js';
export interface ResponseScanHit {
    patternId: string;
    title: string;
    severity: VulnSeverity;
    excerpt: string;
}
export declare function scanToolResultText(text: string): ResponseScanHit[];
/**
 * Scan a tools/call result and optionally persist VulnFinding records.
 * Returns hits; when createFindings=true, upserts injection-class findings.
 */
export declare function scanToolResponse(opts: {
    serverName: string;
    toolName: string;
    result: unknown;
    createFindings?: boolean;
}): {
    hits: ResponseScanHit[];
    findings: VulnFinding[];
    shouldBlock: boolean;
};
//# sourceMappingURL=response-scanner.d.ts.map