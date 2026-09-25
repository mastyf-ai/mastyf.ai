/**
 * Serializable trust score report for cloud certification pages.
 */
import type { ImprovementAction, ScoreInput, TrustScore } from './mastyf-ai-score.js';
import type { SecurityReport } from '../../types.js';
export declare const SCORE_REPORT_CHECK_ID = "mastyf-ai-score-report";
export type PublishableIssue = {
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    title: string;
    plainEnglish: string;
    fixHint: string;
};
export type PublishableCategory = {
    name: string;
    score: number;
    weight: number;
    weightPercent: number;
    contributionPoints: number;
    findings: string[];
    plainEnglish: string;
};
export type PublishableScoreReport = {
    overallScore: number;
    grade: string;
    summaryPlainEnglish: string;
    categories: PublishableCategory[];
    improvementActions: ImprovementAction[];
    issues: PublishableIssue[];
};
export declare function buildPublishableScoreReport(trustScore: TrustScore, issues?: PublishableIssue[]): PublishableScoreReport;
export declare function issuesFromSecurityScan(report: SecurityReport, toolNames: string[], input: ScoreInput): PublishableIssue[];
export declare function scoreReportCheckPayload(report: PublishableScoreReport): Record<string, unknown>;
export declare function parseScoreReportFromChecks(checks: unknown[]): PublishableScoreReport | null;
export declare function certificationChecksOnly(checks: unknown[]): Array<Record<string, unknown>>;
//# sourceMappingURL=score-report.d.ts.map