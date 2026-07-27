/**
 * Validation sandbox — promote candidates to validated with 2-of-3 signals.
 * Precision gates reject numeric targets, ancient NVD spam, and weak novel promotions.
 */
import { unlinkSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { updateFindingStatus, getFinding, listFindings } from './store.js';
import { loadReport } from './vuln-analyst.js';
import { packageAppearsInCveText } from './supply-chain-scanner.js';
import { recordPrecisionEvent } from './precision-metrics.js';
import type { VulnFinding, VulnStatus } from './types.js';

export interface ValidationSignals {
  reproSuccess?: boolean;
  scannerAgreement?: boolean;
  llmConfirmation?: boolean;
}

export interface ValidationResult {
  finding: VulnFinding;
  promoted: boolean;
  signals: ValidationSignals;
  signalCount: number;
  reason: string;
}

function countSignals(s: ValidationSignals): number {
  return [s.reproSuccess, s.scannerAgreement, s.llmConfirmation].filter(Boolean).length;
}

const STRONG_SCANNERS = ['semgrep', 'npm-audit-transitive', 'response-injection-scanner'] as const;

/** Runtime/novel scanners — live exploit signals, not package advisory DBs. */
const RUNTIME_NOVEL_SCANNERS = new Set([
  'mcp-tool-fuzzer',
  'response-injection-scanner',
  'semgrep',
  'heuristic-sast',
  'mcp-protocol-fuzzer',
  'upstream-api-prober',
  'live-traffic-tap',
]);

/** Ancient CVE year without ecosystem evidence is treated as NVD keyword noise. */
const MIN_CVE_YEAR = 2015;

export type DiscoveryLane = 'advisory' | 'novel-runtime' | 'other';

/**
 * Known-ecosystem dependency findings (OSV/NVD/npm audit), including
 * "Pre-advisory audit" titles that lack a CVE- id but are still published advisories.
 */
export function isAdvisoryDependencyFinding(finding: VulnFinding): boolean {
  if (finding.class !== 'dependency') return false;
  const scanner = finding.evidence.scanner;
  return (
    scanner === 'cve-checker'
    || scanner === 'npm-audit-transitive'
    || scanner === 'sbom-diff'
    || finding.title.startsWith('Pre-advisory')
  );
}

/** Live MCP fuzz / response / SAST / protocol signals — true novel/runtime lane. */
export function isRuntimeNovelFinding(finding: VulnFinding): boolean {
  if (RUNTIME_NOVEL_SCANNERS.has(finding.evidence.scanner)) return true;
  return (
    finding.class === 'injection'
    || finding.class === 'implementation'
    || finding.class === 'protocol'
    || finding.class === 'auth'
  );
}

export function discoveryLane(finding: VulnFinding): DiscoveryLane {
  if (isAdvisoryDependencyFinding(finding)) return 'advisory';
  if (isRuntimeNovelFinding(finding)) return 'novel-runtime';
  return 'other';
}

/**
 * @deprecated Prefer isAdvisoryDependencyFinding / isRuntimeNovelFinding.
 * Kept for gates: advisory-without-CVE still needs hard promotion.
 */
export function isNovelOrPreAdvisory(finding: VulnFinding): boolean {
  if (finding.title.startsWith('Pre-advisory')) return true;
  if (finding.class === 'dependency' && !finding.relatedCve) return true;
  return false;
}

/**
 * Hard gate: require explicit llmConfirmation or live reproSuccess —
 * used for advisory-without-CVE and for runtime novel scanners.
 */
export function requiresHardPromotion(finding: VulnFinding): boolean {
  if (isRuntimeNovelFinding(finding)) return true;
  if (isNovelOrPreAdvisory(finding)) return true;
  return false;
}

export function parseCveYear(idOrTitle: string): number | undefined {
  const m = idOrTitle.match(/CVE-(\d{4})-\d+/i);
  if (!m) return undefined;
  const y = parseInt(m[1], 10);
  return Number.isFinite(y) ? y : undefined;
}

/**
 * Detect junk dependency findings (numeric package targets, ancient NVD spam)
 * and runtime false positives (soft-deny labeled as exploit).
 */
export function isNoiseFinding(finding: VulnFinding): { noise: boolean; reason?: string } {
  const name = finding.target?.name?.trim() || '';
  if (/^[\d.]+$/.test(name)) {
    return { noise: true, reason: `numeric package target "${name}"` };
  }

  // Soft-deny / args-echo false positives in novel scanners
  if (
    finding.evidence.scanner === 'mcp-tool-fuzzer'
    || finding.evidence.scanner === 'live-traffic-tap'
  ) {
    const resp = typeof finding.evidence.response === 'string'
      ? finding.evidence.response
      : finding.evidence.response != null
        ? JSON.stringify(finding.evidence.response)
        : '';
    const reproBlob = finding.evidence.reproSteps.join('\n');
    const blob = `${resp}\n${reproBlob}\n${finding.description}`;
    if (/access\s+denied|path\s+outside\s+allowed|outside\s+the\s+allowed/i.test(blob)) {
      return { noise: true, reason: 'soft-deny response without proven exploit effect' };
    }
    if (
      finding.evidence.proxyDecision === 'allow'
      && finding.evidence.rule !== 'exploit-effect'
    ) {
      if (!/exploit effect|crash|PRIVATE KEY|root:[x*]:0:0/i.test(blob)) {
        return { noise: true, reason: 'legacy fuzz-allow without exploit-effect marker' };
      }
    }
  }

  if (finding.class === 'dependency' && finding.evidence.scanner === 'cve-checker') {
    const id = finding.relatedCve || finding.title;
    if (id.startsWith('GHSA-') || finding.relatedCve?.startsWith('GHSA-')) {
      return { noise: false };
    }
    const year = parseCveYear(id) ?? parseCveYear(finding.title);
    if (year !== undefined && year < MIN_CVE_YEAR) {
      if (!packageAppearsInCveText(name, `${finding.title} ${finding.description}`)) {
        return { noise: true, reason: `ancient CVE-${year} without package product match` };
      }
    }
    if (
      finding.relatedCve?.startsWith('CVE-')
      && name.length >= 2
      && !packageAppearsInCveText(name, `${finding.title} ${finding.description}`)
    ) {
      return { noise: true, reason: 'CVE summary lacks package product token' };
    }
  }
  return { noise: false };
}

function deriveScannerAgreement(finding: VulnFinding): boolean {
  const scanner = finding.evidence.scanner;
  const high =
    finding.severity === 'CRITICAL' || finding.severity === 'HIGH';

  if ((STRONG_SCANNERS as readonly string[]).includes(scanner) && high) {
    return true;
  }

  // cve-checker alone is not strong unless OSV/GHSA or credible package match on recent CVE
  if (scanner === 'cve-checker' && high) {
    if (finding.relatedCve?.startsWith('GHSA-') || finding.title.startsWith('GHSA-')) {
      return true;
    }
    const year = parseCveYear(finding.relatedCve || finding.title);
    if (
      year !== undefined
      && year >= MIN_CVE_YEAR
      && packageAppearsInCveText(finding.target.name, `${finding.title} ${finding.description}`)
    ) {
      return true;
    }
  }
  return false;
}

function deriveReproSuccess(finding: VulnFinding): boolean {
  return (
    finding.evidence.reproSteps.length >= 2
    && (!!finding.evidence.payloads?.length
      || !!finding.evidence.stackTrace
      || !!finding.relatedCve)
  );
}

/**
 * Validate a finding. Requires 2-of-3 signals to promote to validated.
 * Deterministic signals can be derived from evidence when not provided —
 * except for novel/pre-advisory findings, which require explicit llmConfirmation
 * or an explicit live reproSuccess flag.
 */
export function validateFinding(
  id: string,
  signals: ValidationSignals = {},
): ValidationResult | undefined {
  const finding = getFinding(id);
  if (!finding) return undefined;

  const noise = isNoiseFinding(finding);
  if (noise.noise) {
    recordPrecisionEvent(finding.evidence.scanner || 'unknown', 'noise_reject');
    return {
      finding,
      promoted: false,
      signals: {},
      signalCount: 0,
      reason: `noise: ${noise.reason}`,
    };
  }

  const derived: ValidationSignals = { ...signals };

  if (isRuntimeNovelFinding(finding)) {
    // Require proven exploit-effect (or explicit caller signals) — not mere allow + payload
    if (derived.reproSuccess === undefined) {
      const effectOk =
        finding.evidence.rule === 'exploit-effect'
        || finding.evidence.proxyDecision === 'allow-exploit';
      derived.reproSuccess =
        (effectOk && !!finding.evidence.payloads?.length)
        || (finding.evidence.scanner === 'response-injection-scanner'
          && !!finding.evidence.payloads?.length
          && finding.evidence.reproSteps.length >= 2)
        || (
          (finding.evidence.scanner === 'semgrep' || finding.evidence.scanner === 'heuristic-sast')
          && finding.evidence.reproSteps.length >= 2
        );
    }
    if (derived.scannerAgreement === undefined) {
      derived.scannerAgreement = !!derived.reproSuccess;
    }
  } else if (isNovelOrPreAdvisory(finding) || isAdvisoryDependencyFinding(finding) && !finding.relatedCve) {
    // Advisory-without-CVE: do not rubber-stamp from the same evidence blob
    if (derived.scannerAgreement === undefined) derived.scannerAgreement = false;
    if (derived.reproSuccess === undefined) derived.reproSuccess = false;
  } else {
    if (derived.scannerAgreement === undefined) {
      derived.scannerAgreement = deriveScannerAgreement(finding);
    }
    if (derived.reproSuccess === undefined) {
      derived.reproSuccess = deriveReproSuccess(finding);
    }
  }

  const n = countSignals(derived);
  if (n >= 2) {
    const updated = updateFindingStatus(id, 'validated', {
      validatedAt: new Date().toISOString(),
    });
    recordPrecisionEvent(finding.evidence.scanner || 'unknown', 'promoted');
    return {
      finding: updated!,
      promoted: true,
      signals: derived,
      signalCount: n,
      reason: `promoted with ${n}/3 signals`,
    };
  }

  return {
    finding,
    promoted: false,
    signals: derived,
    signalCount: n,
    reason: `need 2/3 signals (have ${n})`,
  };
}

export function rejectFinding(id: string, reason?: string): VulnFinding | undefined {
  return updateFindingStatus(id, 'rejected', {
    description: reason
      ? `${getFinding(id)?.description || ''} [rejected: ${reason}]`
      : getFinding(id)?.description,
  });
}

export function markDisclosed(id: string, externalId?: string): VulnFinding | undefined {
  const finding = getFinding(id);
  if (!finding) return undefined;
  if (finding.severity === 'CRITICAL' || finding.severity === 'HIGH') {
    const report = loadReport(id);
    if (!report || report.status !== 'final') {
      throw new Error(
        'CRITICAL/HIGH findings require an approved (final) analysis report before disclosure',
      );
    }
  }
  return updateFindingStatus(id, 'disclosed' as VulnStatus, {
    relatedCve: externalId || finding.relatedCve,
  });
}

/** Auto-validate all HIGH/CRITICAL candidates that meet 2-of-3 deterministic signals. */
export function autoValidateEligible(): ValidationResult[] {
  const candidates = listFindings({ status: 'candidate', minSeverity: 'HIGH' });
  const results: ValidationResult[] = [];
  for (const c of candidates) {
    const r = validateFinding(c.id);
    if (r) results.push(r);
  }
  return results;
}

export interface PurgeNoiseResult {
  rejected: number;
  skipped: number;
  deletedCaches: string[];
  reasons: Array<{ id: string; reason: string }>;
}

function cveCacheDir(): string {
  return process.env.MASTYF_AI_CVE_CACHE_DIR || join(homedir(), '.mastyf-ai', 'cve-cache');
}

/** Delete poisoned NVD disk caches for numeric / ultra-short keyword keys. */
export function deletePoisonedNvdCaches(): string[] {
  const dir = cveCacheDir();
  const deleted: string[] = [];
  if (!existsSync(dir)) return deleted;
  for (const name of readdirSync(dir)) {
    // nvd_3.json, nvd_4.json, nvd_ab.json (short), etc.
    const m = name.match(/^nvd_(.+)\.json$/i);
    if (!m) continue;
    const key = m[1];
    if (/^[\d.]+$/.test(key) || key.length < 4) {
      try {
        unlinkSync(join(dir, name));
        deleted.push(name);
      } catch {
        /* skip */
      }
    }
  }
  return deleted;
}

/**
 * Batch-reject noise findings and delete poisoned numeric NVD disk caches.
 * Soft reject only (append-only store); does not hard-delete JSONL rows.
 */
export function purgeNoiseFindings(): PurgeNoiseResult {
  const deletedCaches = deletePoisonedNvdCaches();
  const reasons: Array<{ id: string; reason: string }> = [];
  let rejected = 0;
  let skipped = 0;

  for (const f of listFindings()) {
    if (f.status === 'rejected') {
      skipped++;
      continue;
    }
    const check = isNoiseFinding(f);
    if (!check.noise) {
      skipped++;
      continue;
    }
    rejectFinding(f.id, check.reason || 'purge-noise');
    reasons.push({ id: f.id, reason: check.reason || 'noise' });
    rejected++;
  }

  return { rejected, skipped, deletedCaches, reasons };
}
