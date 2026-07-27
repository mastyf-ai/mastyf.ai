/**
 * Static + supply-chain scanner — wires CveChecker transitive deps + npm audit
 * into VulnFinding records (including pre-advisory / no-CVE audit findings).
 */
import type { McpServerConfig, CveFinding } from '../types.js';
import { CveChecker, isValidCvePackageName } from '../scanners/cve-checker.js';
import { scanTransitiveCves, type NpmAuditVuln } from '../scanners/transitive-cve-scanner.js';
import { extractPackagesFromServer } from '../utils/package-extractor.js';
import { Logger } from '../utils/logger.js';
import {
  fingerprintFinding,
  getFinding,
  upsertFinding,
  createFindingId,
} from './store.js';
import { buildSbomForServer, saveSbom, loadSbom, diffSbom } from './sbom.js';
import { resolveServerPackageRoot } from './sbom.js';
import type { VulnFinding, VulnSeverity } from './types.js';

function mapCveSeverity(s: string): VulnSeverity {
  const u = s.toUpperCase();
  if (u === 'CRITICAL') return 'CRITICAL';
  if (u === 'HIGH') return 'HIGH';
  if (u === 'MEDIUM' || u === 'MODERATE') return 'MEDIUM';
  if (u === 'LOW') return 'LOW';
  return 'INFO';
}

function mapAuditSeverity(s: NpmAuditVuln['severity']): VulnSeverity {
  if (s === 'critical') return 'CRITICAL';
  if (s === 'high') return 'HIGH';
  if (s === 'moderate') return 'MEDIUM';
  return 'LOW';
}

function upsertFromPartial(
  partial: Omit<VulnFinding, 'id' | 'discoveredAt' | 'fingerprint'> & { fingerprint?: string },
): VulnFinding {
  const fp =
    partial.fingerprint ||
    fingerprintFinding({
      class: partial.class,
      target: partial.target,
      title: partial.title,
      evidence: {
        scanner: partial.evidence.scanner,
        reproSteps: partial.evidence.reproSteps,
      },
    });
  const id = createFindingId(fp);
  const existing = getFinding(id);
  const finding: VulnFinding = {
    ...partial,
    id,
    fingerprint: fp,
    discoveredAt: existing?.discoveredAt || new Date().toISOString(),
    status: existing?.status === 'validated' ? existing.status : partial.status,
    validatedAt: existing?.validatedAt,
    analysisReportId: existing?.analysisReportId,
  };
  return upsertFinding(finding);
}

/** Package token appears as a product match (word boundary), not a digit substring. */
export function packageAppearsInCveText(pkg: string, text: string): boolean {
  const bare = pkg.includes('/') ? pkg.slice(pkg.lastIndexOf('/') + 1) : pkg;
  if (!bare || bare.length < 2 || /^[\d.]+$/.test(bare)) return false;
  const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9_-])${escaped}(?:[^a-z0-9_-]|$)`, 'i').test(text);
}

/**
 * NVD keyword hits are corroboration only unless OSV also reported the same id
 * or the package token is a credible product match in the summary.
 */
export function shouldUpsertCveFinding(
  pkg: string,
  cve: CveFinding,
  osvIds: Set<string>,
): boolean {
  if (cve.id.startsWith('GHSA-') || cve.source === 'osv') return true;
  if (osvIds.has(cve.id)) return true;
  if (cve.source === 'nvd' || (!cve.source && cve.id.startsWith('CVE-'))) {
    return packageAppearsInCveText(pkg, `${cve.id} ${cve.summary}`);
  }
  return true;
}

function cveToFinding(
  serverName: string,
  pkg: string,
  cve: CveFinding,
): VulnFinding {
  return upsertFromPartial({
    class: 'dependency',
    severity: mapCveSeverity(cve.severity),
    status: 'candidate',
    title: `${cve.id}: ${cve.summary.slice(0, 120)}`,
    description: cve.summary,
    target: { kind: 'npm_package', name: pkg, version: cve.fixedVersion },
    evidence: {
      scanner: 'cve-checker',
      reproSteps: [
        `Package ${pkg} reports ${cve.id}`,
        `Severity ${cve.severity}`,
        cve.fixedVersion ? `Fixed in: ${cve.fixedVersion}` : 'No fixed version listed',
        cve.source ? `Source: ${cve.source}` : 'Source: unknown',
      ],
      payloads: [{ cveId: cve.id, source: cve.source }],
    },
    exploitability: {
      preAuth: true,
      networkReachable: true,
      userInteraction: false,
    },
    relatedCve: cve.id.startsWith('CVE-') || cve.id.startsWith('GHSA-') ? cve.id : undefined,
  });
}

function auditToFinding(serverName: string, vuln: NpmAuditVuln): VulnFinding {
  const hasCve = /^CVE-\d{4}-\d+/i.test(vuln.id) || /CVE-\d{4}-\d+/i.test(vuln.title);
  return upsertFromPartial({
    class: 'dependency',
    severity: mapAuditSeverity(vuln.severity),
    status: 'candidate',
    title: hasCve
      ? `${vuln.id}: ${vuln.title.slice(0, 120)}`
      : `Pre-advisory audit: ${vuln.packageName} — ${vuln.title.slice(0, 100)}`,
    description: `${vuln.title} (${vuln.packageName}@${vuln.range}) direct=${vuln.isDirect}`,
    target: {
      kind: 'npm_package',
      name: vuln.packageName,
      version: vuln.range,
    },
    evidence: {
      scanner: 'npm-audit-transitive',
      reproSteps: [
        `npm audit reported ${vuln.id} for ${vuln.packageName}`,
        `Range: ${vuln.range}`,
        vuln.url ? `Advisory: ${vuln.url}` : 'No advisory URL (pre-advisory / unpublished)',
        `MCP server context: ${serverName}`,
      ],
      payloads: [{ auditId: vuln.id, url: vuln.url, isDirect: vuln.isDirect }],
    },
    exploitability: {
      preAuth: true,
      networkReachable: true,
      userInteraction: false,
    },
    relatedCve: hasCve ? vuln.id.match(/CVE-\d{4}-\d+/i)?.[0] : undefined,
  });
}

export interface SupplyChainScanResult {
  findings: VulnFinding[];
  cveCount: number;
  auditCount: number;
  sbomPath?: string;
  sbomDiff?: { added: string[]; removed: string[] };
  errors: string[];
}

/**
 * Full supply-chain scan for one MCP server — OSV/NVD + transitive npm audit + SBOM.
 */
export async function scanServerSupplyChain(
  server: McpServerConfig,
  opts?: { skipAudit?: boolean; skipTransitiveTree?: boolean },
): Promise<SupplyChainScanResult> {
  const findings: VulnFinding[] = [];
  const errors: string[] = [];
  const packages = extractPackagesFromServer(server).filter((p) => isValidCvePackageName(p));
  const checker = new CveChecker();
  let cveCount = 0;
  let auditCount = 0;

  // 1. Direct package CVE lookups (per-package attribution)
  try {
    const perPkg = await checker.checkPackagesIndividually(packages, server.version);
    for (const { packageName, result } of perPkg) {
      const osvIds = new Set(
        result.findings
          .filter((f) => f.source === 'osv' || f.id.startsWith('GHSA-'))
          .map((f) => f.id),
      );
      for (const cve of result.findings) {
        if (!shouldUpsertCveFinding(packageName, cve, osvIds)) continue;
        findings.push(cveToFinding(server.name, packageName, cve));
        cveCount++;
      }
    }
  } catch (err) {
    errors.push(`cve: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. Transitive tree via npm ls when package root available
  if (!opts?.skipTransitiveTree) {
    const root = resolveServerPackageRoot(server);
    if (root) {
      try {
        const treeCves = await checker.scanAllDependencies(root);
        const osvByPkg = new Map<string, Set<string>>();
        for (const { packageName, cve } of treeCves) {
          if (cve.source === 'osv' || cve.id.startsWith('GHSA-')) {
            if (!osvByPkg.has(packageName)) osvByPkg.set(packageName, new Set());
            osvByPkg.get(packageName)!.add(cve.id);
          }
        }
        for (const { packageName, cve } of treeCves) {
          if (!shouldUpsertCveFinding(packageName, cve, osvByPkg.get(packageName) || new Set())) {
            continue;
          }
          findings.push(cveToFinding(server.name, packageName, cve));
          cveCount++;
        }
      } catch (err) {
        errors.push(`transitive-tree: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // 3. npm audit in temp workspace per package
  if (!opts?.skipAudit) {
    for (const pkg of packages.slice(0, 5)) {
      try {
        const audit = await scanTransitiveCves(pkg, server.version || 'latest');
        for (const v of audit.vulnDetails) {
          findings.push(auditToFinding(server.name, v));
          auditCount++;
        }
      } catch (err) {
        errors.push(`audit:${pkg}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // 4. SBOM generate + diff
  let sbomPath: string | undefined;
  let sbomDiff: { added: string[]; removed: string[] } | undefined;
  try {
    const prev = loadSbom(server.name);
    const sbom = buildSbomForServer(server);
    if (sbom) {
      sbomDiff = diffSbom(prev, sbom);
      sbomPath = saveSbom(server.name, sbom);
      if (sbomDiff.added.length > 10) {
        findings.push(
          upsertFromPartial({
            class: 'config',
            severity: 'INFO',
            status: 'candidate',
            title: `SBOM drift: ${sbomDiff.added.length} new components on ${server.name}`,
            description: `Added: ${sbomDiff.added.slice(0, 20).join(', ')}`,
            target: { kind: 'mcp_server', name: server.name },
            evidence: {
              scanner: 'sbom-diff',
              reproSteps: [
                `Previous SBOM compared to current for ${server.name}`,
                `Added ${sbomDiff.added.length}, removed ${sbomDiff.removed.length}`,
              ],
            },
            exploitability: {
              preAuth: false,
              networkReachable: false,
              userInteraction: false,
            },
          }),
        );
      }
    }
  } catch (err) {
    errors.push(`sbom: ${err instanceof Error ? err.message : String(err)}`);
  }

  Logger.info(
    `[vuln:supply-chain] ${server.name}: ${findings.length} findings (cve=${cveCount} audit=${auditCount})`,
  );

  // Enqueue pre-advisory (no CVE) HIGH/CRITICAL audit findings into threat research
  if (process.env.MASTYF_AI_THREAT_RESEARCH_AUTO === 'true') {
    try {
      const { enqueueThreatResearch, buildDependencyAnomalyEvent } = await import(
        '../ai/threat-research-pipeline.js'
      );
      for (const f of findings) {
        if (f.relatedCve) continue;
        if (f.severity !== 'CRITICAL' && f.severity !== 'HIGH') continue;
        if (f.class !== 'dependency') continue;
        enqueueThreatResearch(
          buildDependencyAnomalyEvent({
            id: f.id,
            class: f.class,
            severity: f.severity,
            title: f.title,
            description: f.description,
            target: f.target,
            evidence: {
              reproSteps: f.evidence.reproSteps,
              scanner: f.evidence.scanner,
            },
            fingerprint: f.fingerprint,
          }),
        );
      }
    } catch {
      /* non-fatal */
    }
  }

  return { findings, cveCount, auditCount, sbomPath, sbomDiff, errors };
}
