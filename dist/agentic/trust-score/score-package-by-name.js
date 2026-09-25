import { fetchNpmPackage, isValidNpmPackageName, NpmPackageNotFoundError } from '../../clients/npm-registry-client.js';
import { SecurityScanner } from '../../services/security-scanner.js';
import { SignatureVerifier } from '../supply-chain/signature-verifier.js';
import { MastyfAiScore } from './mastyf-ai-score.js';
import { buildPublishableScoreReport, issuesFromSecurityScan, scoreReportCheckPayload, } from './score-report.js';
import { buildScoreInputFromScan } from '../certification/certify-publish.js';
import { McpClient } from '../../utils/mcp-client.js';
function serverNameFromPackage(packageName) {
    const slash = packageName.lastIndexOf('/');
    return slash >= 0 ? packageName.slice(slash + 1) : packageName;
}
function scoreToLevel(score) {
    if (score >= 90)
        return 'platinum';
    if (score >= 75)
        return 'gold';
    if (score >= 60)
        return 'silver';
    return 'bronze';
}
export function buildPackageMcpConfig(packageName, version) {
    return {
        name: serverNameFromPackage(packageName),
        transport: 'stdio',
        command: 'npx',
        args: ['-y', `${packageName}@${version}`],
        packageName,
        version,
    };
}
async function computePackageScore(packageName, version, tier) {
    const server = buildPackageMcpConfig(packageName, version);
    const scanner = new SecurityScanner();
    const report = await scanner.scanServer(server);
    const supply = new SignatureVerifier().verify(packageName, version);
    let toolNames = [];
    if (tier === 'live') {
        const probe = await McpClient.probe(server);
        toolNames = probe.toolNames ?? [];
        if (probe.success && probe.toolCount && toolNames.length < probe.toolCount) {
            /* probe may return partial names */
        }
    }
    const scoreInput = buildScoreInputFromScan({ server, report, toolNames, blockedCalls: 0 });
    scoreInput.mastyfAiProtected = false;
    scoreInput.responseDlpActive = false;
    scoreInput.trustedPublisher = supply.trustedPublisher && !report.typoSquatRisk.length;
    scoreInput.typoSquatDetected = supply.typoSquat || report.typoSquatRisk.length > 0;
    scoreInput.depConfusionDetected = supply.dependencyConfusion;
    const trustScore = new MastyfAiScore().compute(scoreInput);
    trustScore.includesLiveData = tier === 'live';
    const scoreReport = buildPublishableScoreReport(trustScore, issuesFromSecurityScan(report, toolNames, scoreInput));
    const checks = [
        {
            id: 'trust-score',
            name: 'Trust Score',
            passed: trustScore.overallScore >= 60,
            score: trustScore.overallScore,
            maxScore: 100,
            details: `Trust score: ${trustScore.overallScore}/100 (${tier} scan)`,
        },
        {
            id: 'cve-free',
            name: 'No Critical CVEs',
            passed: report.cves.filter((c) => c.severity === 'CRITICAL').length === 0,
            score: report.cves.length === 0 ? 100 : Math.max(0, 100 - report.cves.length * 15),
            maxScore: 100,
            details: report.cves.length ? `${report.cves.length} CVE(s) found` : 'No known CVEs',
        },
        {
            id: 'supply-chain',
            name: 'Trusted Publisher',
            passed: supply.trustedPublisher,
            score: supply.integrityScore,
            maxScore: 100,
            details: supply.trustedPublisher ? 'Verified publisher' : 'Unknown publisher',
        },
        scoreReportCheckPayload(scoreReport),
    ];
    return {
        packageName,
        version,
        serverName: server.name,
        score: trustScore.overallScore,
        grade: trustScore.grade,
        level: scoreToLevel(trustScore.overallScore),
        scanTier: tier,
        includesLiveData: tier === 'live',
        scoreReport,
        checks,
        computedAt: new Date().toISOString(),
    };
}
export async function scorePackageStatic(packageName, version) {
    const name = packageName.trim();
    if (!isValidNpmPackageName(name)) {
        throw new Error('invalid_package_name');
    }
    const meta = await fetchNpmPackage(name, version);
    return computePackageScore(meta.name, meta.version, 'static');
}
export async function scorePackageLive(packageName, version) {
    const name = packageName.trim();
    if (!isValidNpmPackageName(name)) {
        throw new Error('invalid_package_name');
    }
    const meta = await fetchNpmPackage(name, version);
    return computePackageScore(meta.name, meta.version, 'live');
}
export { NpmPackageNotFoundError, isValidNpmPackageName };
//# sourceMappingURL=score-package-by-name.js.map