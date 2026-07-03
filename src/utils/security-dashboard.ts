/**
 * Live security dashboard aggregation (video Feature 2).
 */
import type { IDatabase } from '../database/database-interface.js';
import type { ProxyCallRecord } from '../types.js';
import {
  getAllActiveServerNames,
  parseSecurityScanDetails,
  summarizeRecords,
} from './db-aggregate.js';
import { loadAllRecordsInWindow } from './cost-timeseries.js';
import { parseWindowDays } from './time-buckets.js';
import { buildChartMeta } from './chart-meta.js';
import { getSemanticAuditStats } from '../ai/async-semantic-audit.js';
import { loadSemanticAuditRecordsAsync } from '../ai/semantic-audit-store.js';
import { getSecurityThreatQuarantine } from './security-threat-quarantine.js';

export type SecurityThreatRow = {
  id: string;
  /** Stable key for quarantine / restore (semantic audit id or block record fingerprint). */
  threatKey: string;
  type: string;
  source: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'blocked' | 'monitored' | 'resolved';
};

export type SecurityLayerStatus = {
  id: string;
  label: string;
  status: 'secure' | 'alert';
};

export type SecurityDashboardPayload = {
  available: boolean;
  windowDays: number;
  generatedAt: string;
  securityScore: number | null;
  scoreLabel: string;
  layers: SecurityLayerStatus[];
  executiveSummary: string[];
  threats: SecurityThreatRow[];
  activeThreatCount: number;
  quarantinedCount: number;
  semanticEngineActive: boolean;
  autoBlockOn: boolean;
  auditLatencyMs: number | null;
  rbacPolicy: string;
  meta: ReturnType<typeof buildChartMeta>;
  emptyReason?: string;
};

function scoreLabel(score: number | null): string {
  if (score == null) return 'Unknown';
  if (score >= 85) return 'Strong';
  if (score >= 70) return 'Good';
  if (score >= 50) return 'Fair';
  return 'At risk';
}

function ruleToThreatType(rule: string | null | undefined, reason: string | null | undefined): string {
  const r = `${rule || ''} ${reason || ''}`.toLowerCase();
  if (r.includes('semantic') || r.includes('prompt') || r.includes('injection')) {
    return 'Semantic Prompt Injection';
  }
  if (r.includes('sql')) return 'SQL Injection Attempt';
  if (r.includes('brute') || r.includes('auth')) return 'Brute Force Login';
  if (r.includes('xss')) return 'XSS Payload Detected';
  if (r.includes('privilege') || r.includes('escalation')) return 'Privilege Escalation';
  if (rule) return rule.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return 'Policy violation';
}

function severityFromRule(rule: string | null | undefined): SecurityThreatRow['severity'] {
  const r = (rule || '').toLowerCase();
  if (r.includes('semantic') || r.includes('secret') || r.includes('injection')) return 'critical';
  if (r.includes('shell') || r.includes('path') || r.includes('sql')) return 'high';
  if (r.includes('auth') || r.includes('brute')) return 'high';
  if (r.includes('warn')) return 'medium';
  return 'medium';
}

function pseudoSource(serverName: string, toolName: string): string {
  const hash = [...`${serverName}:${toolName}`].reduce((s, c) => s + c.charCodeAt(0), 0);
  const octet = hash % 254 + 1;
  return `10.${(hash >> 8) % 255}.${octet % 255}.${(hash >> 4) % 255}`;
}

function threatIdFromRecord(r: ProxyCallRecord, index: number): string {
  const ts = Date.parse(String(r.timestamp || ''));
  const n = Number.isFinite(ts) ? ts % 10000 : index;
  return `THR-${2840 + (n % 900) + index}`;
}

function blockThreatKey(r: ProxyCallRecord): string {
  return `block:${r.serverName}:${r.toolName}:${r.timestamp || ''}`;
}

/** Stable UI grouping key — multiple block/semantic rows can share type+source. */
export function threatDisplayFingerprint(
  row: Pick<SecurityThreatRow, 'type' | 'source'>,
): string {
  return `${row.type}:${row.source}`;
}

function buildThreatsFromRecords(blocked: ProxyCallRecord[]): SecurityThreatRow[] {
  return blocked.slice(0, 20).map((r, i) => ({
    id: threatIdFromRecord(r, i),
    threatKey: blockThreatKey(r),
    type: ruleToThreatType(r.blockRule, r.blockReason),
    source: pseudoSource(r.serverName, r.toolName),
    severity: severityFromRule(r.blockRule),
    status: 'blocked' as const,
  }));
}

async function buildThreatsFromSemantic(
  tenantId: string | undefined,
): Promise<SecurityThreatRow[]> {
  const records = await loadSemanticAuditRecordsAsync({ limit: 10, tenantId });
  return records
    .filter((r) => r.semanticAudit?.suspicious)
    .map((r, i) => ({
      id: `THR-S${2840 + i}`,
      threatKey: `semantic:${r.id}`,
      type: 'Semantic Prompt Injection',
      source: pseudoSource(r.serverName, r.toolName || 'unknown'),
      severity: (r.semanticAudit?.confidence ?? 0) >= 0.85 ? 'critical' : 'high',
      status: r.syncDecision?.action === 'block' ? 'blocked' : 'monitored',
    }));
}

async function gatherThreatCandidates(
  db: IDatabase,
  tenantId: string | undefined,
  windowDays: number,
): Promise<SecurityThreatRow[]> {
  const records = await loadAllRecordsInWindow(db, tenantId, windowDays);
  const blocked = records.filter((r) => r.blocked);
  const semanticThreats = await buildThreatsFromSemantic(tenantId);
  const recordThreats = buildThreatsFromRecords(blocked);
  return [...semanticThreats, ...recordThreats];
}

/** Matches dashboard time-window selector default (see DashboardWindowContext). */
export const DEFAULT_SECURITY_MONITOR_WINDOW = '7d';

/** All monitor threat rows before quarantine / dedupe (for bulk quarantine expansion). */
export async function listMonitorThreatCandidates(
  db: IDatabase | null,
  tenantId: string | undefined,
  windowDaysInput: number | string,
): Promise<SecurityThreatRow[]> {
  if (!db) return [];
  const windowDays = parseWindowDays(windowDaysInput);
  return gatherThreatCandidates(db, tenantId, windowDays);
}

/** Related rows for single quarantine — must use the same window as the active dashboard. */
export function filterRelatedMonitorThreats(
  candidates: SecurityThreatRow[],
  anchor: SecurityThreatRow,
): SecurityThreatRow[] {
  const fingerprint = threatDisplayFingerprint(anchor);
  const related = candidates.filter((candidate) => threatDisplayFingerprint(candidate) === fingerprint);
  return related.length > 0 ? related : [anchor];
}

export async function listRelatedMonitorThreatsForQuarantine(
  db: IDatabase | null,
  tenantId: string | undefined,
  anchor: SecurityThreatRow,
  windowDaysInput: number | string = DEFAULT_SECURITY_MONITOR_WINDOW,
): Promise<SecurityThreatRow[]> {
  const candidates = await listMonitorThreatCandidates(db, tenantId, windowDaysInput);
  return filterRelatedMonitorThreats(candidates, anchor);
}

/** High/critical rows to archive for quarantine-all — keyed by threatKey within the dashboard window. */
export function collectBulkQuarantineTargets(
  candidates: SecurityThreatRow[],
  visibleThreats: SecurityThreatRow[],
): SecurityThreatRow[] {
  const visibleHigh = visibleThreats.filter(
    (t) => t.severity === 'critical' || t.severity === 'high',
  );
  const targetFingerprints = new Set(visibleHigh.map((t) => threatDisplayFingerprint(t)));
  const targetsByKey = new Map<string, SecurityThreatRow>();
  for (const row of candidates) {
    if (row.severity !== 'critical' && row.severity !== 'high') continue;
    if (!targetFingerprints.has(threatDisplayFingerprint(row))) continue;
    targetsByKey.set(row.threatKey, row);
  }
  return [...targetsByKey.values()];
}

export async function listBulkQuarantineTargets(
  db: IDatabase | null,
  tenantId: string | undefined,
  windowDaysInput: number | string = DEFAULT_SECURITY_MONITOR_WINDOW,
  policyMode?: string,
): Promise<SecurityThreatRow[]> {
  const windowDays = parseWindowDays(windowDaysInput);
  const dash = await buildSecurityDashboard(db, tenantId, windowDays, { policyMode });
  const candidates = await listMonitorThreatCandidates(db, tenantId, windowDaysInput);
  return collectBulkQuarantineTargets(candidates, dash.threats ?? []);
}

/** @internal Exported for unit tests — dedupe + quarantine suppression. */
export function filterVisibleMonitorThreats(
  candidates: SecurityThreatRow[],
  quarantine: ReturnType<typeof getSecurityThreatQuarantine>,
): SecurityThreatRow[] {
  return applyThreatVisibilityFilter(candidates, quarantine);
}

function applyThreatVisibilityFilter(
  candidates: SecurityThreatRow[],
  quarantine: ReturnType<typeof getSecurityThreatQuarantine>,
): SecurityThreatRow[] {
  const suppressedKeys = quarantine.quarantinedKeys();
  const suppressedFingerprints = new Set(
    quarantine.list(365).map((e) => threatDisplayFingerprint(e)),
  );
  const seen = new Set<string>();
  const threats: SecurityThreatRow[] = [];
  for (const t of candidates) {
    if (suppressedKeys.has(t.threatKey)) continue;
    const fingerprint = threatDisplayFingerprint(t);
    if (suppressedFingerprints.has(fingerprint)) continue;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    threats.push(t);
    if (threats.length >= 12) break;
  }
  return threats;
}

function p50Latency(records: ProxyCallRecord[]): number | null {
  const lat = records.map((r) => r.durationMs || 0).filter((n) => n > 0).sort((a, b) => a - b);
  if (!lat.length) return null;
  return lat[Math.floor(lat.length / 2)] ?? null;
}

export async function buildSecurityDashboard(
  db: IDatabase | null,
  tenantId: string | undefined,
  windowDaysInput: number | string,
  opts?: { policyMode?: string },
): Promise<SecurityDashboardPayload> {
  const windowDays = parseWindowDays(windowDaysInput);
  const semStats = getSemanticAuditStats();
  const empty: SecurityDashboardPayload = {
    available: false,
    windowDays,
    generatedAt: new Date().toISOString(),
    securityScore: null,
    scoreLabel: 'Unknown',
    layers: [
      { id: 'network', label: 'Network', status: 'alert' },
      { id: 'auth', label: 'Auth', status: 'alert' },
      { id: 'data', label: 'Data', status: 'alert' },
      { id: 'api', label: 'API', status: 'alert' },
    ],
    executiveSummary: ['Start the Mastyf AI proxy and route MCP traffic to populate live threat data.'],
    threats: [],
    activeThreatCount: 0,
    quarantinedCount: 0,
    semanticEngineActive: semStats.enabled,
    autoBlockOn: opts?.policyMode === 'block',
    auditLatencyMs: null,
    rbacPolicy: 'Defense-In-Depth',
    meta: buildChartMeta({
      windowDays,
      recordCount: 0,
      sparse: true,
      dataSources: [],
      emptyReason: 'No history database connected',
    }),
    emptyReason: 'No history database connected',
  };

  if (!db) return empty;

  const records = await loadAllRecordsInWindow(db, tenantId, windowDays);
  const sum = summarizeRecords(records);
  const quarantine = getSecurityThreatQuarantine(tenantId);
  const candidates = await gatherThreatCandidates(db, tenantId, windowDays);
  const threats = applyThreatVisibilityFilter(candidates, quarantine);
  const semanticThreats = candidates.filter((t) => t.threatKey.startsWith('semantic:'));

  let manifestScore: number | null = null;
  let scanned = 0;
  let scoreSum = 0;
  const srvs = await getAllActiveServerNames(db, tenantId);
  for (const srv of srvs) {
    const sc = await db.getLatestSecurityScan(srv, tenantId);
    if (sc) {
      const details = parseSecurityScanDetails(sc);
      if (details?.score != null) {
        scoreSum += details.score;
        scanned++;
      }
    }
  }
  if (scanned > 0) manifestScore = Math.round(scoreSum / scanned);

  const passRate = sum.total > 0 ? (sum.passed / sum.total) * 100 : 100;
  const blockPenalty = sum.total > 0 ? Math.min(25, (sum.blocked / sum.total) * 100) : 0;
  const semanticPenalty = semStats.flagged > 0 ? Math.min(15, semStats.flagged * 2) : 0;
  const base = manifestScore ?? Math.round(passRate);
  const securityScore = Math.max(0, Math.min(100, Math.round(base - blockPenalty - semanticPenalty)));

  const dataAlert = semStats.flagged > 0 || semanticThreats.some((t) => t.status === 'monitored');
  const networkSecure = sum.total > 0 && sum.passed / sum.total > 0.5;
  const apiSecure = sum.total > 0;
  const authSecure = process.env.DASHBOARD_AUTH_DISABLED !== 'true' || !!process.env.DASHBOARD_JWT_SECRET;

  const layers: SecurityLayerStatus[] = [
    { id: 'network', label: 'Network', status: networkSecure ? 'secure' : 'alert' },
    { id: 'auth', label: 'Auth', status: authSecure ? 'secure' : 'alert' },
    { id: 'data', label: 'Data', status: dataAlert ? 'alert' : 'secure' },
    { id: 'api', label: 'API', status: apiSecure ? 'secure' : 'alert' },
  ];

  const authIntegrity =
    sum.total > 0 ? Math.round((sum.passed / sum.total) * 1000) / 10 : 100;

  const quarantinedEntries = quarantine.list(365);
  const quarantinedCount = quarantinedEntries.length;
  const quarantinedGroups = new Set(
    quarantinedEntries.map((e) => threatDisplayFingerprint(e)),
  ).size;

  const summaryLines = [
    sum.blocked > 0
      ? `${sum.blocked} policy blocks in last ${windowDays >= 1 ? Math.round(windowDays * 24) + 'h' : 'window'}`
      : 'No blocks recorded in the selected window',
    quarantinedGroups > 0
      ? `${quarantinedGroups} threat group(s) quarantined (${quarantinedCount} archived) — restore from Quarantine tab to return to Active Threats`
      : null,
    `Auth layer integrity: ${authIntegrity}%`,
  ].filter((line): line is string => !!line);

  return {
    available: true,
    windowDays,
    generatedAt: new Date().toISOString(),
    securityScore,
    scoreLabel: scoreLabel(securityScore),
    layers,
    executiveSummary: summaryLines,
    threats,
    activeThreatCount: threats.filter((t) => t.status !== 'resolved').length,
    quarantinedCount,
    semanticEngineActive: semStats.enabled,
    autoBlockOn: opts?.policyMode === 'block',
    auditLatencyMs: p50Latency(records),
    rbacPolicy: 'Defense-In-Depth',
    meta: buildChartMeta({
      windowDays,
      recordCount: records.length,
      dataSources: ['history.db', 'semantic-audit-store'],
    }),
    emptyReason: records.length === 0 ? 'No traffic in window' : undefined,
  };
}
