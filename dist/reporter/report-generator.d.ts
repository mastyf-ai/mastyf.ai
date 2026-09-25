import { FullReport, SecurityReport, CostReport, HealthReport } from '../types.js';
export declare class ReportGenerator {
    formatSecurityReports(reports: SecurityReport[]): string;
    formatCostReports(reports: CostReport[]): string;
    formatHealthReports(reports: HealthReport[]): string;
    formatFullReport(report: FullReport): string;
    toMarkdown(report: FullReport): string;
}
//# sourceMappingURL=report-generator.d.ts.map