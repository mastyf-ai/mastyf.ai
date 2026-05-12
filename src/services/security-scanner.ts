import { SecurityReport, McpServerConfig, CveFinding, AuthStatus, TypoSquatResult, SecretFinding } from '../types.js';
import { CveChecker } from '../scanners/cve-checker.js';
import { AuthProber } from '../scanners/auth-prober.js';
import { TypoSquatDetector } from '../scanners/typo-squat-detector.js';
import { SecretScanner } from '../scanners/secret-scanner.js';
import { CommandValidator } from '../scanners/command-validator.js';
import { Logger } from '../utils/logger.js';

async function safeRun<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    Logger.warn(`[Scanner:${name}] Failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err; // Let Promise.all handle — but this way we can log which scanner failed
  }
}

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
    const [
      cvesResult, authResult, typosResult, secretsResult, cmdWarningsResult,
    ] = await Promise.allSettled([
      safeRun('cve', () => this.cveChecker.check(server.packageName || server.name, server.version)),
      safeRun('auth', () => Promise.resolve(this.authProber.probe(server))),
      safeRun('typo', () => Promise.resolve(this.typoDetector.detect(server.name))),
      safeRun('secret', () => Promise.resolve(this.secretScanner.scan(server))),
      safeRun('command', () => Promise.resolve(this.cmdValidator.validate(server))),
    ]);

    const cves: CveFinding[] = cvesResult.status === 'fulfilled' ? cvesResult.value : [];
    const auth: AuthStatus = authResult.status === 'fulfilled'
      ? authResult.value
      : { hasAuthentication: false, isTransportEncrypted: false };
    const typos: TypoSquatResult[] = typosResult.status === 'fulfilled' ? typosResult.value : [];
    const secrets: SecretFinding[] = secretsResult.status === 'fulfilled' ? secretsResult.value : [];
    const cmdWarnings: import('../scanners/command-validator.js').CommandWarning[] =
      cmdWarningsResult.status === 'fulfilled' ? cmdWarningsResult.value : [];

    const score = calculateSecurityScore(cves, auth, typos, secrets, cmdWarnings, DEFAULT_SCORING, {
      hasMTLS: auth.method === 'mTLS',
    });
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

export interface ScoringConfig {
  penalties: {
    cveCritical: number;
    cveHigh: number;
    cveMedium: number;
    noAuth: number;
    unencryptedTransport: number;
    typosquat: number;
    secretFound: number;
    cmdHigh: number;
    cmdMedium: number;
  };
  bonuses: {
    authPresent: number;
    mTLS: number;
    pinnedLockfile: number;
    sbomPresent: number;
  };
}

const DEFAULT_SCORING: ScoringConfig = {
  penalties: {
    cveCritical: 30, cveHigh: 20, cveMedium: 10,
    noAuth: 30, unencryptedTransport: 10,
    typosquat: 30, secretFound: 25,
    cmdHigh: 25, cmdMedium: 10,
  },
  bonuses: {
    authPresent: 20, mTLS: 10, pinnedLockfile: 5, sbomPresent: 5,
  },
};

function calculateSecurityScore(
  cves: CveFinding[],
  auth: AuthStatus,
  typos: TypoSquatResult[],
  secrets: SecretFinding[],
  cmdWarnings: import('../scanners/command-validator.js').CommandWarning[],
  config: ScoringConfig = DEFAULT_SCORING,
  environmentFlags?: { hasMTLS?: boolean; hasPinnedLockfile?: boolean; hasSBOM?: boolean }
): number {
  let penalty = 0;
  // Compound CVE scoring: each additional CVE adds diminishing penalty (log₂ scale)
  const criticalCount = cves.filter(c => c.severity === 'CRITICAL').length;
  const highCount = cves.filter(c => c.severity === 'HIGH').length;
  const mediumCount = cves.filter(c => c.severity === 'MEDIUM').length;
  const compoundFactor = (count: number): number => Math.min(count, 1 + Math.log2(Math.max(count, 1)));
  if (criticalCount > 0) penalty += Math.round(config.penalties.cveCritical * compoundFactor(criticalCount));
  if (highCount > 0) penalty += Math.round(config.penalties.cveHigh * compoundFactor(highCount));
  if (mediumCount > 0) penalty += Math.round(config.penalties.cveMedium * compoundFactor(mediumCount));
  if (!auth.hasAuthentication) penalty += config.penalties.noAuth;
  if (!auth.isTransportEncrypted) penalty += config.penalties.unencryptedTransport;
  if (typos.length > 0) penalty += config.penalties.typosquat;
  if (secrets.length > 0) penalty += config.penalties.secretFound * Math.min(secrets.length, 3);
  if (cmdWarnings.some(w => w.severity === 'high')) penalty += config.penalties.cmdHigh;
  if (cmdWarnings.some(w => w.severity === 'medium')) penalty += config.penalties.cmdMedium;

  let bonus = 0;
  if (auth.hasAuthentication) bonus += config.bonuses.authPresent;
  if (environmentFlags?.hasMTLS) bonus += config.bonuses.mTLS;
  if (environmentFlags?.hasPinnedLockfile) bonus += config.bonuses.pinnedLockfile;
  if (environmentFlags?.hasSBOM) bonus += config.bonuses.sbomPresent;

  const score = 100 - penalty + bonus;
  return Math.max(0, Math.min(100, score));
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
    recs.push(`[${w.severity}] ${w.token}: ${w.message}`);
  }
  if (recs.length === 0) recs.push('No security issues found');
  return recs;
}
