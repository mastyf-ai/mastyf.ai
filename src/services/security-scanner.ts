import { SecurityReport, McpServerConfig, CveFinding, AuthStatus, TypoSquatResult, SecretFinding } from '../types.js';
import { CveChecker } from '../scanners/cve-checker.js';
import { AuthProber } from '../scanners/auth-prober.js';
import { TypoSquatDetector } from '../scanners/typo-squat-detector.js';
import { SecretScanner } from '../scanners/secret-scanner.js';

/**
 * Orchestrates all security scanning for a single MCP server.
 * Runs CVE checks, auth probing, typo-squat detection, and secret scanning in parallel.
 */
export class SecurityScanner {
  private cveChecker: CveChecker;
  private authProber: AuthProber;
  private typoDetector: TypoSquatDetector;
  private secretScanner: SecretScanner;

  constructor() {
    this.cveChecker = new CveChecker();
    this.authProber = new AuthProber();
    this.typoDetector = new TypoSquatDetector();
    this.secretScanner = new SecretScanner();
  }

  async scanServer(server: McpServerConfig): Promise<SecurityReport> {
    const [cves, auth, typos, secrets] = await Promise.all([
      this.cveChecker.check(server.packageName || server.name, server.version),
      Promise.resolve(this.authProber.probe(server)),
      Promise.resolve(this.typoDetector.detect(server.name)),
      Promise.resolve(this.secretScanner.scan(server)),
    ]);

    const score = calculateSecurityScore(cves, auth, typos, secrets);
    return {
      serverName: server.name,
      cves,
      authStatus: auth,
      typoSquatRisk: typos,
      secretsFound: secrets,
      score,
      recommendations: generateRecommendations(cves, auth, typos, secrets),
    };
  }
}

function calculateSecurityScore(
  cves: CveFinding[],
  auth: AuthStatus,
  typos: TypoSquatResult[],
  secrets: SecretFinding[]
): number {
  let score = 100;
  if (cves.some((c) => c.severity === 'CRITICAL')) score -= 40;
  if (cves.some((c) => c.severity === 'HIGH')) score -= 20;
  if (cves.some((c) => c.severity === 'MEDIUM')) score -= 10;
  if (!auth.hasAuthentication) score -= 20;
  if (!auth.isTransportEncrypted) score -= 10;
  if (typos.length > 0) score -= 30;
  if (secrets.length > 0) score -= 15;
  return Math.max(0, score);
}

function generateRecommendations(
  cves: CveFinding[],
  auth: AuthStatus,
  typos: TypoSquatResult[],
  secrets: SecretFinding[]
): string[] {
  const recs: string[] = [];
  if (cves.length > 0) {
    const criticalCount = cves.filter((c) => c.severity === 'CRITICAL').length;
    const highCount = cves.filter((c) => c.severity === 'HIGH').length;
    recs.push(`Update to fix ${cves.length} known vulnerabilities${criticalCount > 0 ? ` (${criticalCount} critical)` : ''}${highCount > 0 ? `, ${highCount} high` : ''}`);
    const fixedCves = cves.filter((c) => c.fixedVersion);
    if (fixedCves.length > 0) {
      recs.push(`CVE(s) with available fixes: ${fixedCves.map((c) => `${c.id} → v${c.fixedVersion}`).join(', ')}`);
    }
  }
  if (!auth.hasAuthentication) recs.push('Add authentication headers or API keys to prevent unauthorized access');
  if (!auth.isTransportEncrypted) recs.push('Use HTTPS or secure transport for remote servers');
  if (typos.length > 0) recs.push(`Verify package name against official registry — possible typo-squatting: ${typos.map((t) => t.similarityTo).join(', ')}`);
  if (secrets.length > 0) recs.push(`Remove ${secrets.length} hardcoded secret(s) from tool definitions — use environment variable references instead`);
  if (recs.length === 0) recs.push('No security issues found');
  return recs;
}