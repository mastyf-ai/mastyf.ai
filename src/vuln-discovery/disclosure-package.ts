/**
 * Vendor disclosure package builder — evidence + full analysis, never invents CVE IDs.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { getFinding } from './store.js';
import { analyzeFinding, loadReport, saveReport } from './vuln-analyst.js';
import { ensureVulnStoreDir, vulnDisclosureDir } from './paths.js';
import type { VulnAnalysisReport, VulnFinding } from './types.js';

export type DisclosureCveStatus = 'none' | 'linked';

export interface DisclosurePackage {
  findingId: string;
  vendorReady: boolean;
  preview: boolean;
  cveStatus: DisclosureCveStatus;
  /** Only set when already present on the finding — never invented. */
  relatedCve?: string;
  finding: VulnFinding;
  report: VulnAnalysisReport;
  evidence: {
    reproSteps: string[];
    payloads?: unknown[];
    request?: unknown;
    response?: unknown;
    scanner: string;
    rule?: string;
    proxyDecision?: string;
    stackTrace?: string;
  };
  citations: VulnAnalysisReport['citations'];
  vendorSummary: {
    executiveSummary: string;
    disclosureGuidance: string;
    estimatedSeverity: string;
  };
  policyHint?: string;
  acceptedPolicyRuleId?: string;
  corpusFixtureId?: string;
  threatLabCandidateId?: string;
  paths: {
    dir: string;
    reportMd: string;
    reportJson: string;
    packageJson: string;
    readme: string;
    zip?: string;
  };
  builtAt: string;
}

const README_TEXT = `# Vendor disclosure package

This package was produced by Mastyf AI Vuln Discovery for coordinated disclosure.

## Contents
- \`report.md\` / \`report.json\` — full multi-pass analysis
- \`disclosure-package.json\` — structured bundle (finding + evidence + citations)

## CVE IDs
Mastyf does **not** mint CVE identifiers. If \`cveStatus\` is \`none\`, request a CVE
from a CNA (e.g. MITRE, GitHub, or your vendor's CNA) after responsible disclosure.
If \`relatedCve\` is present, it was linked from existing evidence — not invented.

## Next steps
1. Review \`report.md\` with your security team
2. Contact the vendor / maintainer using \`disclosureGuidance\`
3. Optionally request a CVE from a CNA once the issue is confirmed
`;

function isThinReport(report: VulnAnalysisReport | null): boolean {
  if (!report) return true;
  if (report.status === 'stale') return true;
  if (report.source === 'template-fallback') return true;
  const guidance = report.sections.disclosureGuidance?.trim() || '';
  const mitigations = report.sections.mitigations?.trim() || '';
  return guidance.length < 40 || mitigations.length < 40;
}

async function enrichThreatLabLinks(findingId: string): Promise<{
  acceptedPolicyRuleId?: string;
  corpusFixtureId?: string;
  threatLabCandidateId?: string;
  policyHint?: string;
}> {
  try {
    const { findThreatLabCandidateUngated } = await import('../utils/swarm-artifacts.js');
    const cand = findThreatLabCandidateUngated(undefined, findingId);
    if (!cand) return {};
    const corpus = cand.corpusCandidate as { advId?: string; id?: string } | undefined;
    return {
      threatLabCandidateId: cand.id,
      acceptedPolicyRuleId:
        cand.reviewStatus === 'accepted'
          ? (typeof cand.policyRule?.name === 'string' ? cand.policyRule.name : undefined)
            || cand.id
          : undefined,
      corpusFixtureId: corpus?.advId || corpus?.id,
    };
  } catch {
    return {};
  }
}

/** Minimal ZIP (store method) for disclosure export — no external deps. */
export function zipStoreFiles(files: Array<{ name: string; data: Buffer | string }>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const data = typeof f.data === 'string' ? Buffer.from(f.data, 'utf8') : f.data;
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // store
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(0, 14); // crc (optional for store; leave 0)
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    parts.push(local, data);

    const cen = Buffer.alloc(46 + nameBuf.length);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0, 14);
    cen.writeUInt32LE(0, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);
    nameBuf.copy(cen, 46);
    central.push(cen);
    offset += local.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, centralBuf, end]);
}

/**
 * Build (or rebuild) disclosure package from finding + analysis report on disk.
 * Requires an analysis report; use prepareDisclosurePackage to analyze first.
 */
export async function buildDisclosurePackage(
  findingId: string,
  opts?: { requireFinal?: boolean },
): Promise<DisclosurePackage> {
  const finding = getFinding(findingId);
  if (!finding) {
    throw new Error(`Finding not found: ${findingId}`);
  }

  const report = loadReport(findingId);
  if (!report) {
    throw new Error(`No analysis report for ${findingId} — run prepare-disclosure or analyze first`);
  }

  const vendorReady = report.status === 'final';
  if (opts?.requireFinal && !vendorReady) {
    throw new Error(
      `Analysis is ${report.status}; approve analysis before vendor-ready export`,
    );
  }

  // Never invent CVE IDs — only link what is already on the finding
  const relatedCve = finding.relatedCve?.trim() || undefined;
  if (relatedCve && !/^CVE-\d{4}-\d{4,}$/i.test(relatedCve)) {
    throw new Error(`Invalid relatedCve on finding (refusing to export): ${relatedCve}`);
  }

  const links = await enrichThreatLabLinks(findingId);
  ensureVulnStoreDir();
  const dir = vulnDisclosureDir(findingId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const reportMd = join(dir, 'report.md');
  const reportJson = join(dir, 'report.json');
  const packageJson = join(dir, 'disclosure-package.json');
  const readme = join(dir, 'README.md');
  const zipPath = join(dir, 'disclosure-package.zip');

  writeFileSync(reportMd, report.fullText);
  writeFileSync(reportJson, JSON.stringify(report, null, 2));
  writeFileSync(readme, README_TEXT);
  // Keep analyst report dir in sync
  saveReport(report);

  const pkg: DisclosurePackage = {
    findingId,
    vendorReady,
    preview: !vendorReady,
    cveStatus: relatedCve ? 'linked' : 'none',
    relatedCve,
    finding,
    report,
    evidence: {
      reproSteps: finding.evidence.reproSteps || [],
      payloads: finding.evidence.payloads,
      request: finding.evidence.request,
      response: finding.evidence.response,
      scanner: finding.evidence.scanner,
      rule: finding.evidence.rule,
      proxyDecision: finding.evidence.proxyDecision,
      stackTrace: finding.evidence.stackTrace,
    },
    citations: report.citations || [],
    vendorSummary: {
      executiveSummary: report.sections.executiveSummary || '',
      disclosureGuidance: report.sections.disclosureGuidance || '',
      estimatedSeverity: report.sections.estimatedSeverity || finding.severity,
    },
    policyHint: report.sections.mastyfRecommendations || links.policyHint,
    acceptedPolicyRuleId: links.acceptedPolicyRuleId,
    corpusFixtureId: links.corpusFixtureId,
    threatLabCandidateId: links.threatLabCandidateId,
    paths: {
      dir,
      reportMd,
      reportJson,
      packageJson,
      readme,
      zip: zipPath,
    },
    builtAt: new Date().toISOString(),
  };

  writeFileSync(packageJson, JSON.stringify(pkg, null, 2));

  const zipBuf = zipStoreFiles([
    { name: 'README.md', data: README_TEXT },
    { name: 'report.md', data: report.fullText },
    { name: 'report.json', data: JSON.stringify(report, null, 2) },
    { name: 'disclosure-package.json', data: JSON.stringify(pkg, null, 2) },
  ]);
  writeFileSync(zipPath, zipBuf);
  pkg.paths.zip = zipPath;

  return pkg;
}

/**
 * Ensure 3-pass analysis exists, then build disclosure package.
 * Preview allowed without approve; vendorReady requires final (approved) report.
 */
export async function prepareDisclosurePackage(
  findingId: string,
  opts?: { forceAnalyze?: boolean },
): Promise<DisclosurePackage> {
  const finding = getFinding(findingId);
  if (!finding) {
    throw new Error(`Finding not found: ${findingId}`);
  }

  let report = loadReport(findingId);
  const needAnalyze = opts?.forceAnalyze || isThinReport(report);
  if (needAnalyze) {
    report = await analyzeFinding(findingId, { force: true, passes: 3 });
    if (!report) {
      throw new Error(`Analysis failed for ${findingId}`);
    }
  }

  return buildDisclosurePackage(findingId);
}

export function readDisclosurePackageZip(findingId: string): Buffer | null {
  const zipPath = join(vulnDisclosureDir(findingId), 'disclosure-package.zip');
  if (!existsSync(zipPath)) return null;
  return readFileSync(zipPath);
}

export function loadDisclosurePackageMeta(findingId: string): DisclosurePackage | null {
  const p = join(vulnDisclosureDir(findingId), 'disclosure-package.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as DisclosurePackage;
  } catch {
    return null;
  }
}
