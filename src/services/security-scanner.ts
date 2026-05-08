import { SecurityReport, McpServerConfig, CveFinding, AuthStatus, TypoSquatResult, SecretFinding } from '../types.js';
import { CveChecker } from '../scanners/cve-checker.js';
import { AuthProber } from '../scanners/auth-prober.js';
import { TypoSquatDetector } from '../scanners/typo-squat-detector.js';
import { SecretScanner } from '../scanners/secret-scanner.js';
import { CommandValidator } from '../scanners/command-validator.js';

/**
 * Orchestrates all security scanning for a single MCP server.
 * Runs CVE checks, auth probing, typo-squat detection, and secret scanning in parallel.
 */
export class SecurityScanner {
  private cveChecker: CveChecker;
  private authProber: AuthProber;
  private typoDetector: TypoSquatDetector;
  private secretScanner: SecretScanner;
  private cmdValidator: CommandValidator;

  constructor(
    cveChecker?: CveChecker,
    authProber?: AuthProber,
    typoDetector?: TypoSquatDetector,
    secretScanner?: SecretScanner,
    cmdValidator?: CommandValidator
  ) {
    this.cveChecker = cveChecker || new CveChecker();
    this.authProber = authProber || new AuthProber();
    this.typoDetector = typoDetector || new TypoSquatDetector();
    this.secretScanner = secretScanner || new SecretScanner();
    this.cmdValidator = cmdValidator || new CommandValidator();
  }

  async scanServer(server: McpServerConfig): Promise<SecurityReport> {
    const [cves, auth, typos, secrets, cmdWarnings] = await Promise.all([
      this.cveChecker.check(server.packageName || server.name, server.version),
      Promise.resolve(this.authProber.probe(server)),
      Promise.resolve(this.typoDetector.detect(server.name)),
      Promise.resolve(this.secretScanner.scan(server)),
      Promise.resolve(this.cmdValidator.validate(server)),
    ]);

    const score = calculateSecurityScore(cves, auth, typos, secrets, cmdWarnings);
    const recommendations = generateRecommendations(cves, auth, typos, secrets, cmdWarnings);
    return {
      serverName: server.name,
      cves,
      authStatus: auth,
      typoSquatRisk: typos,
      secretsFound: secrets,
      score,
      recommendations,
    };
  }
}

function calculateSecurityScore(
  cves: CveFinding[],
  auth: AuthStatus,
  typos: TypoSquatResult[],
  secrets: SecretFinding[],
  cmdWarnings: import('../scanners/command-validator.js').CommandWarning[]
): number {
  let score = 100;
  if (cves.some((c) => c.severity === 'CRITICAL')) score -= 40;
  if (cves.some((c) => c.severity === 'HIGH')) score -= 20;
  if (cves.some((c) => c.severity === 'MEDIUM')) score -= 10;
  if (!auth.hasAuthentication) score -= 20;
  if (!auth.isTransportEncrypted) score -= 10;
  if (typos.length > 0) score -= 30;
  if (secrets.length > 0) score -= 15;
  if (cmdWarnings.some((w) => w.severity === 'HIGH')) score -= 25;
  if (cmdWarnings.some((w) => w.severity === 'MEDIUM')) score -= 10;
  return Math.max(0, score);
}

function generateRecommendations(
  cves: CveFinding[],
  auth: AuthStatus,
  typos: TypoSquatResult[],
  secrets: SecretFinding[],
  cmdWarnings: import('../scanners/command-validator.js').CommandWarning[]
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
  for (const w of cmdWarnings) {
    recs.push(`[${w.severity}] ${w.field}: ${w.issue}`);
  }
  if (recs.length === 0) recs.push('No security issues found');
  return recs;
}
