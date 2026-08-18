/**
 * Merge normalisation layer.
 *
 * Unifies the two historical cache formats into one enriched view so every
 * available datum surfaces in the cards and on the detail page.
 *
 * OLD format checks: trust-score, cve-free, supply-chain, mastyf-ai-score-report
 *   (score_report carries categories/issues/improvementActions/probe)
 * NEW format checks: npm-metadata, cve-scan, license, maintainers, freshness, supply-chain
 *   (score_report carries only categories with name/score/weight)
 */
import type {
  ImprovementAction,
  PublishableCategory,
  PublishableIssue,
  PublishableScoreReport,
} from '@/lib/score-report';

export type CveSummary = {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  maxCvss: number;
};

export type AttackProbe = {
  error?: string;
  rejected?: number;
  attempted?: number;
  reflected?: number;
  secretLeaks?: number;
};

/** Unified, fully-populated insight bundle for a package. */
export type MergedPackageData = {
  score: number;
  grade: string;
  level: string;
  summary: string;
  categories: PublishableCategory[];
  issues: PublishableIssue[];
  improvementActions: ImprovementAction[];
  probe: AttackProbe | null;
  // ── package metadata ──
  license?: string;
  description?: string;
  downloads?: number;
  version?: string;
  // ── supply chain ──
  hasRepo?: boolean;
  depCount?: number;
  maintainers?: number;
  // ── freshness ──
  packageAgeDays?: number;
  lastPublishedDays?: number;
  // ── CVE posture ──
  cves: CveSummary;
  // ── legacy certifications ──
  trustScore?: number;
  cveFree?: boolean;
  trustedPublisher?: boolean;
};

const CATEGORY_PLAIN: Record<string, string> = {
  cvePosture: 'Known vulnerabilities and critical CVEs in the package and its dependency tree.',
  supplyChainIntegrity: 'Publisher identity, repository presence, and dependency count.',
  authStrength: 'Authentication mechanisms the server exposes to clients.',
  transportSecurity: 'TLS / HTTPS / mTLS enforcement for the network transport.',
  observedAttackHistory: 'Historical CVEs and prior attack/advisory records for the package.',
  responseHygiene: 'How the server handles malformed input, secrets in output, and DLP.',
  configurationFreshness: 'How recently the package was published and whether it is actively maintained.',
  abilityRiskSurface: 'How dangerous the exposed MCP tools are (filesystem, shell, network, secrets).',
  licenseRisk: 'License type and the legal/supply-chain risk it introduces.',
  downloadHealth: 'Community adoption signal from npm weekly downloads.',
  'Publisher Integrity': 'Publisher identity, maintainer history, and trusted-scope verification.',
  'Dependency Hygiene': 'Dependency count, lockfile verification, and known-vulnerable dependencies.',
  'Malware & Egress': 'Behavioral scan for malicious post-install scripts and outbound data egress.',
  'Authentication': 'Authentication mechanisms the server exposes to clients.',
  'Transport Security': 'TLS / HTTPS / mTLS enforcement for the network transport.',
  'Tool Capability': 'How dangerous the exposed MCP tools are (filesystem, shell, network, secrets).',
  'Attack History': 'Historical CVEs and prior attack/advisory records for the package.',
  'Response Hygiene': 'How the server handles malformed input, secrets in output, and DLP.',
  'Live Health': 'Whether the live server boots, handshakes, and responds under probe.',
  'Protection Layer': 'Whether a filtering proxy / DLP layer guards the server.',
  'Freshness': 'How recently the package was published and whether it is actively maintained.',
};

function scoreToPlainEnglish(name: string, score: number): string {
  const base = CATEGORY_PLAIN[name] ?? `Assessment of ${name}.`;
  if (score >= 70) return `${base} Score ${score}/100 — strong.`;
  if (score >= 40) return `${base} Score ${score}/100 — needs improvement.`;
  return `${base} Score ${score}/100 — weak, address this.`;
}

function severityFromScore(score: number): PublishableIssue['severity'] {
  if (score >= 90) return 'info';
  if (score >= 70) return 'low';
  if (score >= 40) return 'medium';
  return 'high';
}

/** Read a single check object; tolerate unknown shapes. */
function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Pull every known datum out of a checks array, regardless of format. */
export function extractInsightsFromChecks(checks: unknown[]): MergedPackageData {
  let license: string | undefined;
  let description: string | undefined;
  let downloads: number | undefined;
  let hasRepo: boolean | undefined;
  let depCount: number | undefined;
  let maintainers: number | undefined;
  let packageAgeDays: number | undefined;
  let lastPublishedDays: number | undefined;
  let trustScore: number | undefined;
  let cveFree: boolean | undefined;
  let trustedPublisher: boolean | undefined;
  let probe: AttackProbe | null = null;
  const cves: CveSummary = { total: 0, critical: 0, high: 0, medium: 0, low: 0, maxCvss: 0 };
  let report: PublishableScoreReport | null = null;

  for (const raw of checks) {
    const c = asRecord(raw);
    const id = str(c.id);
    switch (id) {
      case 'npm-metadata':
        license = str(c.license) ?? license;
        description = str(c.description) ?? description;
        downloads = num(c.downloads) ?? downloads;
        break;
      case 'cve-scan':
        cves.total = num(c.total) ?? cves.total;
        cves.critical = num(c.critical) ?? cves.critical;
        cves.high = num(c.high) ?? cves.high;
        cves.medium = num(c.medium) ?? cves.medium;
        cves.low = num(c.low) ?? cves.low;
        cves.maxCvss = num(c.maxCvss) ?? cves.maxCvss;
        break;
      case 'license':
        license = str(c.value) ?? license;
        break;
      case 'maintainers':
        maintainers = num(c.count) ?? maintainers;
        break;
      case 'freshness':
        packageAgeDays = num(c.packageAgeDays) ?? packageAgeDays;
        lastPublishedDays = num(c.lastPublishedDays) ?? lastPublishedDays;
        break;
      case 'supply-chain':
        hasRepo = bool(c.hasRepo) ?? hasRepo;
        depCount = num(c.depCount) ?? depCount;
        break;
      case 'trust-score':
        trustScore = num(c.score) ?? trustScore;
        break;
      case 'cve-free':
        cveFree = bool(c.passed) ?? cveFree;
        break;
      case 'mastyf-ai-score-report': {
        report = c as unknown as PublishableScoreReport;
        if (c.probe) {
          const p = asRecord(c.probe);
          probe = {
            error: str(p.error),
            rejected: num(p.rejected),
            attempted: num(p.attempted),
            reflected: num(p.reflected),
            secretLeaks: num(p.secretLeaks),
          };
        }
        const cvs = asRecord(c.cves);
        if (cvs && num(cvs.total) !== undefined) {
          cves.total = num(cvs.total) ?? cves.total;
          cves.critical = num(cvs.critical) ?? cves.critical;
          cves.high = num(cvs.high) ?? cves.high;
          cves.medium = num(cvs.medium) ?? cves.medium;
          cves.low = num(cvs.low) ?? cves.low;
          cves.maxCvss = num(cvs.maxCvss) ?? cves.maxCvss;
        }
        break;
      }
      default:
        // Supply-chain checks in old format carry score/passed but no nested fields.
        if (id === 'supply-chain') {
          trustedPublisher = bool(c.passed) ?? trustedPublisher;
        }
        break;
    }
  }

  return {
    score: num(report?.overallScore) ?? trustScore ?? 0,
    grade: str(report?.grade) ?? 'N/A',
    level: '',
    summary: str(report?.summaryPlainEnglish) ?? 'No summary available.',
    categories: [],
    issues: [],
    improvementActions: [],
    probe,
    license,
    description,
    downloads,
    hasRepo,
    depCount,
    maintainers,
    packageAgeDays,
    lastPublishedDays,
    cves,
    trustScore,
    cveFree,
    trustedPublisher,
  };
}

/** Normalise a raw category row (old or new shape) into the publishable type. */
function normalizeCategory(raw: PublishableCategory | Record<string, unknown>): PublishableCategory {
  const name = str(raw.name) ?? 'Check';
  const score = num(raw.score) ?? 0;
  const weight = num(raw.weight) ?? 1 / Math.max(1, 1);
  return {
    name,
    score,
    weight,
    weightPercent: num(raw.weightPercent) ?? Math.round(weight * 100),
    contributionPoints: num(raw.contributionPoints) ?? Math.round(score * weight),
    findings: Array.isArray(raw.findings) ? (raw.findings as string[]) : [],
    plainEnglish: str(raw.plainEnglish) ?? scoreToPlainEnglish(name, score),
  };
}

/** Build improvement actions from weak categories. */
function actionsFromCategories(categories: PublishableCategory[]): ImprovementAction[] {
  return categories
    .filter((c) => c.score < 70)
    .sort((a, b) => a.score - b.score)
    .slice(0, 6)
    .map((c) => ({
      priority: (c.score < 40 ? 'immediate' : c.score < 60 ? 'high' : 'medium') as ImprovementAction['priority'],
      category: c.name,
      action: `Improve ${c.name} — current score ${c.score}/100. ${scoreToPlainEnglish(c.name, c.score)}`,
      expectedScoreIncrease: Math.round((100 - c.score) * (c.weight ?? 0.1)),
      effort: (c.score < 40 ? 'weeks' : c.score < 60 ? 'days' : 'hours') as ImprovementAction['effort'],
    }));
}

/** Build issues from a CVE summary. */
function issuesFromCves(cves: CveSummary): PublishableIssue[] {
  if (cves.total <= 0) return [];
  const issues: PublishableIssue[] = [];
  const add = (count: number, severity: PublishableIssue['severity'], label: string) => {
    if (count > 0) {
      issues.push({
        severity,
        title: `${count} ${label} CVE${count > 1 ? 's' : ''}`,
        plainEnglish: `The scan found ${count} known ${label.toLowerCase()} severity ${count > 1 ? 'vulnerabilities' : 'vulnerability'} affecting this package or its dependencies.`,
        fixHint: 'Update to a patched version, pin the dependency tree, and re-run the scan.',
      });
    }
  };
  add(cves.critical, 'critical', 'critical');
  add(cves.high, 'high', 'high');
  add(cves.medium, 'medium', 'medium');
  add(cves.low, 'low', 'low');
  return issues;
}

/**
 * Merge a cached score result's score_report + checks into a fully-populated
 * MergedPackageData. Fills gaps introduced by either format so the UI always
 * has categories, issues, improvement actions, and probe data to render.
 */
export function mergePackageData(
  scoreReport: PublishableScoreReport | null | undefined,
  checks: unknown[],
  fallbackScore: number,
  fallbackGrade: string,
  fallbackLevel: string,
  version?: string,
): MergedPackageData {
  const extracted = extractInsightsFromChecks(checks);
  const rawCategories = Array.isArray(scoreReport?.categories)
    ? scoreReport.categories
    : [];
  const categories = rawCategories.map(normalizeCategory);

  const issues = Array.isArray(scoreReport?.issues) && scoreReport.issues.length > 0
    ? scoreReport.issues
    : issuesFromCves(extracted.cves);

  const improvementActions = Array.isArray(scoreReport?.improvementActions) && scoreReport.improvementActions.length > 0
    ? scoreReport.improvementActions
    : actionsFromCategories(categories);

  const summary = str(scoreReport?.summaryPlainEnglish)
    ?? extracted.summary
    ?? `This package scores ${fallbackScore}/100 (grade ${fallbackGrade}).`;

  return {
    score: num(scoreReport?.overallScore) ?? fallbackScore,
    grade: str(scoreReport?.grade) ?? fallbackGrade,
    level: fallbackLevel,
    summary,
    categories,
    issues,
    improvementActions,
    probe: extracted.probe,
    license: extracted.license,
    description: extracted.description,
    downloads: extracted.downloads,
    version,
    hasRepo: extracted.hasRepo,
    depCount: extracted.depCount,
    maintainers: extracted.maintainers,
    packageAgeDays: extracted.packageAgeDays,
    lastPublishedDays: extracted.lastPublishedDays,
    cves: extracted.cves,
    trustScore: extracted.trustScore,
    cveFree: extracted.cveFree,
    trustedPublisher: extracted.trustedPublisher,
  };
}

export function formatDownloads(n?: number): string {
  if (n === undefined || n === null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatDays(d?: number): string {
  if (d === undefined || d === null) return '—';
  return `${d}d`;
}