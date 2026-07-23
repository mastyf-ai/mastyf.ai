/**
 * Persist async semantic audit outcomes for swarm calibrator and dashboard labels.
 * PostgreSQL when DB_TYPE=postgres + DATABASE_URL; JSONL fallback for local dev.
 */
import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { homedir } from 'os';
import { join } from 'path';
import type { SemanticAuditResult } from './async-semantic-audit.js';
import type { PolicyDecision } from '../policy/policy-types.js';
import { DEFAULT_TENANT_ID, resolveTenantId } from '../tenant/resolve-tenant.js';

export interface StoredSemanticAudit {
  id: string;
  tenantId: string;
  requestId: string | number;
  serverName: string;
  toolName: string;
  syncDecision: PolicyDecision;
  semanticAudit: SemanticAuditResult;
  model?: string;
  durationMs?: number;
  timestamp: string;
  labeled?: boolean;
  label?: 'true_positive' | 'false_positive' | 'ignored';
  labelUserId?: string;
  labelAt?: string;
  /** Redacted tool arguments for counterfactual replay (no secrets). */
  argumentsSnapshot?: Record<string, unknown>;
}

const MAX_RECORDS = parseInt(process.env.MASTYF_AI_SEMANTIC_STORE_MAX || '5000', 10);

/** Shared dashboard / investigator lookup window (matches /api/learning/semantic/outcomes). */
export const SEMANTIC_AUDIT_DASHBOARD_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function normalizeSemanticAuditTriggerId(triggerId: string): string {
  const trimmed = triggerId.trim();
  if (trimmed.startsWith('semantic:')) return trimmed.slice('semantic:'.length);
  return trimmed;
}

export function findSemanticAuditRecord(
  records: StoredSemanticAudit[],
  triggerId: string,
): StoredSemanticAudit | undefined {
  const normalized = normalizeSemanticAuditTriggerId(triggerId);
  return records.find(
    (r) => r.id === normalized || r.id === triggerId || `semantic:${r.id}` === triggerId,
  );
}

/** Load records for a tenant, falling back to default tenant when the scoped store is empty. */
export async function loadSemanticAuditRecordsWithTenantFallback(opts?: {
  tenantId?: string;
  sinceMs?: number;
  limit?: number;
}): Promise<{ records: StoredSemanticAudit[]; resolvedTenantId: string }> {
  const sinceMs = opts?.sinceMs ?? SEMANTIC_AUDIT_DASHBOARD_WINDOW_MS;
  const limit = opts?.limit ?? 2000;
  const tenantId = opts?.tenantId || resolveTenantId();
  let records = await loadSemanticAuditRecordsAsync({ tenantId, sinceMs, limit });
  if (records.length === 0 && tenantId !== DEFAULT_TENANT_ID) {
    records = await loadSemanticAuditRecordsAsync({
      tenantId: DEFAULT_TENANT_ID,
      sinceMs,
      limit,
    });
    if (records.length > 0) {
      return { records, resolvedTenantId: DEFAULT_TENANT_ID };
    }
  }
  return { records, resolvedTenantId: tenantId };
}

function storePath(tenantId?: string): string {
  const tid = tenantId || resolveTenantId();
  const base = join(homedir(), '.mastyf-ai', 'tenants', tid);
  if (tid === 'default') {
    return join(homedir(), '.mastyf-ai', 'semantic-audit-outcomes.jsonl');
  }
  return join(base, 'semantic-audit-outcomes.jsonl');
}

function appendJsonl(record: StoredSemanticAudit): void {
  const path = storePath(record.tenantId);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf-8');
  trimStore(path);
}

export function appendSemanticAuditRecord(record: Omit<StoredSemanticAudit, 'id' | 'tenantId'>): StoredSemanticAudit {
  const tenantId = resolveTenantId();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const line: StoredSemanticAudit = { id, tenantId, ...record };
  appendJsonl(line);
  void import('./semantic-audit-pg.js').then(async ({ pgAppendSemanticAuditRecord, isSemanticAuditPostgresEnabled }) => {
    if (!isSemanticAuditPostgresEnabled()) return;
    await pgAppendSemanticAuditRecord({ ...record, id, timestamp: record.timestamp });
  });
  return line;
}

export function seedSemanticAuditFromBlocks(entries: Array<{ tool: string; args: string; category: string; description: string; expected_action: string }>): number {
  let count = 0;
  for (const e of entries.slice(0, 20)) {
    try {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(e.args || '{}'); } catch {}
      appendSemanticAuditRecord({
        requestId: `seed-${Date.now()}-${count}`,
        serverName: 'default',
        toolName: e.tool,
        syncDecision: { action: 'block' as const, rule: e.category, reason: e.description },
        semanticAudit: { suspicious: true, confidence: 0.6, categories: [e.category], reasoning: e.description },
        timestamp: new Date().toISOString(),
        argumentsSnapshot: args,
      });
      count++;
    } catch { /* skip malformed */ }
  }
  return count;
}

function trimStore(path: string): void {
  if (!existsSync(path)) return;
  try {
    const lines = readFileSync(path, 'utf-8').trim().split('\n').filter(Boolean);
    if (lines.length <= MAX_RECORDS) return;
    const kept = lines.slice(-MAX_RECORDS);
    writeFileSync(path, `${kept.join('\n')}\n`, 'utf-8');
  } catch {
    /* best-effort */
  }
}

function loadJsonlRecords(opts?: {
  tenantId?: string;
  sinceMs?: number;
  limit?: number;
}): StoredSemanticAudit[] {
  const tid = opts?.tenantId || resolveTenantId();
  const path = storePath(tid);
  if (!existsSync(path)) return [];
  const since = opts?.sinceMs ?? 7 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - since;
  const limit = opts?.limit ?? 2000;
  const out: StoredSemanticAudit[] = [];
  try {
    const lines = readFileSync(path, 'utf-8').trim().split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      const rec = JSON.parse(lines[i]) as StoredSemanticAudit;
      const recTenant = rec.tenantId || DEFAULT_TENANT_ID;
      if (recTenant !== tid) continue;
      if (new Date(rec.timestamp).getTime() >= cutoff) out.push(rec);
    }
  } catch {
    return [];
  }
  return out.reverse();
}

/** Merge Postgres + JSONL (dedupe by id; Postgres wins). */
export async function loadSemanticAuditRecordsAsync(opts?: {
  tenantId?: string;
  sinceMs?: number;
  limit?: number;
}): Promise<StoredSemanticAudit[]> {
  const limit = opts?.limit ?? 2000;
  const { pgLoadSemanticAuditRecords, isSemanticAuditPostgresEnabled } = await import(
    './semantic-audit-pg.js'
  );
  const jsonl = loadJsonlRecords(opts);
  if (!isSemanticAuditPostgresEnabled()) return jsonl;
  const pg = await pgLoadSemanticAuditRecords(opts);
  if (!pg.length) return jsonl;
  const byId = new Map<string, StoredSemanticAudit>();
  for (const r of jsonl) byId.set(r.id, r);
  for (const r of pg) byId.set(r.id, r);
  return [...byId.values()]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .slice(-limit);
}

/** Sync load — JSONL only (tests / local scripts without async). */
export function loadSemanticAuditRecords(opts?: {
  tenantId?: string;
  sinceMs?: number;
  limit?: number;
}): StoredSemanticAudit[] {
  return loadJsonlRecords(opts);
}

export async function labelSemanticAuditRecord(
  id: string,
  label: 'true_positive' | 'false_positive' | 'ignored',
  userId: string,
  tenantId?: string,
): Promise<boolean> {
  const { pgLabelSemanticAuditRecord, isSemanticAuditPostgresEnabled } = await import(
    './semantic-audit-pg.js'
  );
  if (isSemanticAuditPostgresEnabled()) {
    const pgOk = await pgLabelSemanticAuditRecord(id, label, userId, tenantId);
    if (pgOk) return true;
  }
  return labelSemanticAuditRecordJsonl(id, label, userId, tenantId);
}

function labelSemanticAuditRecordJsonl(
  id: string,
  label: 'true_positive' | 'false_positive' | 'ignored',
  userId: string,
  tenantId?: string,
): boolean {
  const path = storePath(tenantId);
  if (!existsSync(path)) return false;
  const lines = readFileSync(path, 'utf-8').trim().split('\n').filter(Boolean);
  let found = false;
  const updated = lines.map((line) => {
    const rec = JSON.parse(line) as StoredSemanticAudit;
    if (rec.id !== id) return line;
    found = true;
    rec.labeled = true;
    rec.label = label;
    rec.labelUserId = userId;
    rec.labelAt = new Date().toISOString();
    return JSON.stringify(rec);
  });
  if (!found) return false;
  writeFileSync(path, `${updated.join('\n')}\n`, 'utf-8');
  return true;
}
