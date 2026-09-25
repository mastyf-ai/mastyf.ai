/**
 * On-demand MCP package scoring by npm name (static + optional live probe).
 */
import type { McpServerConfig } from '../../types.js';
import { isValidNpmPackageName, NpmPackageNotFoundError } from '../../clients/npm-registry-client.js';
import { type PublishableScoreReport } from './score-report.js';
import { computeTrustGrade } from './trust-badge-grade.js';
export type PackageScoreTier = 'static' | 'live';
export type PackageScoreResult = {
    packageName: string;
    version: string;
    serverName: string;
    score: number;
    grade: ReturnType<typeof computeTrustGrade>;
    level: string;
    scanTier: PackageScoreTier;
    includesLiveData: boolean;
    scoreReport: PublishableScoreReport;
    checks: unknown[];
    computedAt: string;
    description?: string;
};
export declare function buildPackageMcpConfig(packageName: string, version: string): McpServerConfig;
export declare function scorePackageStatic(packageName: string, version?: string): Promise<PackageScoreResult>;
export declare function scorePackageLive(packageName: string, version?: string): Promise<PackageScoreResult>;
export { NpmPackageNotFoundError, isValidNpmPackageName };
//# sourceMappingURL=score-package-by-name.d.ts.map