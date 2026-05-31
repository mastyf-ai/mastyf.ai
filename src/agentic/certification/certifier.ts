/**
 * MCP Server Certification Program (#2) — automated certification pipeline.
 */
import { Logger } from '../../utils/logger.js';
import { signCertAttestation, verifyCertAttestation } from './cert-signing.js';
import { IndustryStandardStore } from '../../database/industry-standard-store.js';
import { GuardianScore, type ScoreInput } from '../trust-score/guardian-score.js';
import type { ReputationNetwork } from '../reputation/reputation-network.js';

export interface CertificationResult {
  serverName: string; packageName: string; version: string;
  certified: boolean; level: 'bronze' | 'silver' | 'gold' | 'platinum';
  score: number; checks: CertificationCheck[];
  signedAttestation?: string; issuedAt: string; expiresAt: string;
  registeredInRegistry: boolean;
}
export interface CertificationCheck {
  id: string; name: string; passed: boolean; score: number; maxScore: number; details: string;
}

export interface CertifyManualInputs {
  trustScore: number; complianceScore: number; cveFree: boolean;
  authMethod: string; transport: string; trustedPublisher: boolean;
}

export class MCPCertifier {
  private registry = new Map<string, CertificationResult>();
  private readonly guardianScore: GuardianScore;

  constructor(
    private readonly store?: IndustryStandardStore,
    guardianScore?: GuardianScore,
    private readonly reputationNetwork?: ReputationNetwork,
  ) {
    this.guardianScore = guardianScore ?? new GuardianScore();
  }

  /** Auto-collect certification inputs from GuardianScore + CVE posture. */
  collectFromGuardianScore(input: Partial<ScoreInput> & { serverName: string }): CertifyManualInputs {
    const score = this.guardianScore.compute({
      serverName: input.serverName,
      cveCount: input.cveCount ?? 0,
      maxCvss: input.maxCvss ?? 0,
      newestCveAgeDays: input.newestCveAgeDays ?? 0,
      authMethod: input.authMethod ?? 'none',
      transport: input.transport ?? 'stdio',
      highRiskToolCount: input.highRiskToolCount ?? 0,
      mediumRiskToolCount: input.mediumRiskToolCount ?? 0,
      totalToolCount: input.totalToolCount ?? 0,
      trustedPublisher: input.trustedPublisher ?? false,
      typoSquatDetected: input.typoSquatDetected ?? false,
      depConfusionDetected: input.depConfusionDetected ?? false,
      blockedCalls: input.blockedCalls ?? 0,
      bypassedAttacks: input.bypassedAttacks ?? 0,
      responseDlpActive: input.responseDlpActive ?? false,
      guardianProtected: input.guardianProtected ?? true,
    });
    const cveFree = (input.cveCount ?? 0) === 0 || (input.maxCvss ?? 0) < 7;
    return {
      trustScore: score.overallScore,
      complianceScore: Math.round(score.overallScore * 0.85),
      cveFree,
      authMethod: input.authMethod ?? 'none',
      transport: input.transport ?? 'stdio',
      trustedPublisher: input.trustedPublisher ?? false,
    };
  }

  certify(
    serverName: string,
    packageName: string,
    version: string,
    results: CertifyManualInputs,
  ): CertificationResult {
    const checks: CertificationCheck[] = [
      { id: 'trust-score', name: 'Trust Score ≥ 60', passed: results.trustScore >= 60, score: Math.min(results.trustScore, 100), maxScore: 100, details: `Trust score: ${results.trustScore}/100` },
      { id: 'compliance', name: 'Compliance Score ≥ 50', passed: results.complianceScore >= 50, score: Math.min(results.complianceScore, 100), maxScore: 100, details: `Compliance: ${results.complianceScore}%` },
      { id: 'cve-free', name: 'No Critical CVEs', passed: results.cveFree, score: results.cveFree ? 100 : 0, maxScore: 100, details: results.cveFree ? 'No critical CVEs' : 'Critical CVEs present' },
      { id: 'auth', name: 'Authentication Configured', passed: results.authMethod !== 'none', score: results.authMethod !== 'none' ? 100 : 0, maxScore: 100, details: `Auth: ${results.authMethod}` },
      { id: 'transport', name: 'Secure Transport', passed: results.transport !== 'http', score: results.transport === 'mTLS' ? 100 : results.transport === 'https' ? 70 : 30, maxScore: 100, details: `Transport: ${results.transport}` },
      { id: 'supply-chain', name: 'Trusted Publisher', passed: results.trustedPublisher, score: results.trustedPublisher ? 100 : 0, maxScore: 100, details: results.trustedPublisher ? 'Verified publisher' : 'Unknown publisher' },
    ];
    const totalScore = Math.round(checks.reduce((s, c) => s + c.score, 0) / checks.length);
    let level: CertificationResult['level'] = totalScore >= 90 ? 'platinum' : totalScore >= 75 ? 'gold' : totalScore >= 60 ? 'silver' : 'bronze';

    if (this.reputationNetwork) {
      const netCheck = this.reputationNetwork.validateCertAgainstReputation(serverName, level, packageName);
      checks.push({
        id: 'network-reputation',
        name: 'Network Reputation Consensus',
        passed: netCheck.valid,
        score: netCheck.valid ? 100 : 0,
        maxScore: 100,
        details: netCheck.valid
          ? `Network level: ${netCheck.networkLevel ?? 'unknown'}`
          : (netCheck.reason ?? 'Cert exceeds network consensus'),
      });
      if (!netCheck.valid && level === 'platinum') level = 'gold';
      if (!netCheck.valid && level === 'gold') level = 'silver';
    }

    const finalAllPassed = checks.every(c => c.passed);
    const finalScore = Math.round(checks.reduce((s, c) => s + c.score, 0) / checks.length);
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 90 * 86400000).toISOString();
    const signedAttestation = signCertAttestation({
      serverName, packageName, version, level, score: finalScore, issuedAt, expiresAt,
    });
    const result: CertificationResult = {
      serverName, packageName, version, certified: finalAllPassed && finalScore >= 60,
      level, score: finalScore, checks, signedAttestation, issuedAt, expiresAt,
      registeredInRegistry: false,
    };
    this.registry.set(serverName, result);
    result.registeredInRegistry = true;

    this.store?.saveCertification({
      id: `${serverName}-${issuedAt}`,
      serverName,
      packageName,
      version,
      level,
      score: finalScore,
      certified: result.certified,
      attestationJws: signedAttestation,
      checksJson: JSON.stringify(checks),
      issuedAt,
      expiresAt,
      tenantId: 'default',
    });

    Logger.info(`[Certifier] ${serverName} certified: ${level} (${finalScore}/100)`);
    return result;
  }

  certifyFromScan(serverName: string, packageName: string, version: string, scan: Partial<ScoreInput>): CertificationResult {
    const inputs = this.collectFromGuardianScore({ ...scan, serverName });
    return this.certify(serverName, packageName, version, inputs);
  }

  getCertification(serverName: string): CertificationResult | undefined {
    const cached = this.registry.get(serverName);
    if (cached) return cached;
    const row = this.store?.getCertification(serverName);
    if (!row) return undefined;
    return {
      serverName: row.serverName,
      packageName: row.packageName,
      version: row.version,
      certified: row.certified,
      level: row.level as CertificationResult['level'],
      score: row.score,
      checks: JSON.parse(row.checksJson) as CertificationCheck[],
      signedAttestation: row.attestationJws,
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      registeredInRegistry: true,
    };
  }

  listCertified(): CertificationResult[] {
    if (this.registry.size > 0) return [...this.registry.values()];
    return this.store?.listCertifications().map((row) => ({
      serverName: row.serverName,
      packageName: row.packageName,
      version: row.version,
      certified: row.certified,
      level: row.level as CertificationResult['level'],
      score: row.score,
      checks: JSON.parse(row.checksJson) as CertificationCheck[],
      signedAttestation: row.attestationJws,
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      registeredInRegistry: true,
    })) ?? [];
  }

  verifyCertification(serverName: string, attestationJws?: string): {
    valid: boolean;
    level?: CertificationResult['level'];
    reason?: string;
  } {
    const cert = this.getCertification(serverName);
    if (!cert) return { valid: false, reason: 'not_certified' };
    const jws = attestationJws ?? cert.signedAttestation;
    if (!jws) return { valid: false, reason: 'missing_attestation' };
    const v = verifyCertAttestation(jws);
    if (!v.valid) return { valid: false, reason: v.reason };
    return { valid: true, level: cert.level };
  }
}
