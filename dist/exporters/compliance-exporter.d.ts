/**
 * Compliance Framework Exporter
 *
 * Generates auditable security reports mapping mastyf.ai perimeter controls,
 * policy evaluation logs, and runtime telemetry to major compliance standards:
 *   - SOC 2 (Trust Services Criteria)
 *   - HIPAA Security Rule
 *   - PCI-DSS v4.0
 *   - ISO/IEC 27001:2022
 */
export type ComplianceStandard = 'SOC2' | 'HIPAA' | 'PCI-DSS' | 'ISO27001';
export interface ComplianceControlMapping {
    controlId: string;
    name: string;
    category: string;
    status: 'passed' | 'warning' | 'failed';
    mastyfFeature: string;
    evidenceSummary: string;
}
export interface ComplianceReport {
    standard: ComplianceStandard;
    generatedAt: string;
    tenantId: string;
    overallScore: number;
    controlsEvaluated: number;
    controlsPassed: number;
    mappings: ComplianceControlMapping[];
}
export declare class ComplianceExporter {
    generateReport(options: {
        standard: ComplianceStandard;
        tenantId?: string;
        metrics?: {
            totalBlocked: number;
            totalPassed: number;
            activeRules: number;
        };
    }): ComplianceReport;
}
export declare const globalComplianceExporter: ComplianceExporter;
//# sourceMappingURL=compliance-exporter.d.ts.map