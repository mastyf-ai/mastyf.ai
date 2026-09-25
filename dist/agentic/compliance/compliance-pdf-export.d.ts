import type { ComplianceEvidenceBundle } from './compliance-evidence-runner.js';
export declare function complianceEvidenceDir(): string;
export declare function writeComplianceEvidencePdf(bundle: ComplianceEvidenceBundle): Promise<string>;
/** Shared minimal PDF writer for compliance + insurance reports (C4). */
export declare function writePdfFromLines(lines: string[], outputPath: string): {
    path: string;
    pdfBase64: string;
};
//# sourceMappingURL=compliance-pdf-export.d.ts.map