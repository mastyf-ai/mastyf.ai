/**
 * Build ScoreInput + certification from security scan and proxy history.
 */
import type { McpServerConfig, SecurityReport } from '../../types.js';
import type { ScoreInput } from '../trust-score/mastyf-ai-score.js';
import { type CertificationResult } from './certifier.js';
export declare function classifyToolRisk(toolNames: string[]): {
    highRiskToolCount: number;
    mediumRiskToolCount: number;
    totalToolCount: number;
};
export declare function buildScoreInputFromScan(opts: {
    server: McpServerConfig;
    report: SecurityReport;
    toolNames?: string[];
    blockedCalls?: number;
    bypassedAttacks?: number;
}): ScoreInput;
export declare function scanServerForCertification(server: McpServerConfig, dbPath?: string): Promise<{
    report: SecurityReport;
    toolNames: string[];
    blockedCalls: number;
}>;
export type CertifyPublishResult = {
    certification: CertificationResult;
    cloudId?: string;
    badgeMarkdown: string;
    verifyUrl: string;
};
export declare function runCertifyPublish(opts: {
    serverName: string;
    packageName: string;
    version: string;
    cloudUrl: string;
    apiKey?: string;
    dbPath?: string;
    server?: McpServerConfig;
}): Promise<CertifyPublishResult>;
export declare function previewBadgeSvg(score: number, packageName: string): string;
//# sourceMappingURL=certify-publish.d.ts.map