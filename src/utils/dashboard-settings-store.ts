/**
 * Small file-backed stores behind two dashboard features:
 *
 *  - Cost budget: a monthly spend budget and the share of it that raises an alert.
 *  - Policy history: a copy of the policy every time it is saved from the dashboard, so an
 *    operator can see what changed and restore an earlier version.
 *
 * Both live under ~/.mastyf-ai/tenants/<tenant>/ next to the other per-tenant state.
 */
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { load } from 'js-yaml';

function tenantDir(tenantId: string): string {
  const safe = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/.test(tenantId) ? tenantId : 'default';
  return join(homedir(), '.mastyf-ai', 'tenants', safe);
}

// ── Cost budget ─────────────────────────────────────────────────────────────

export interface CostBudgetSettings {
  /** Monthly budget in USD, or null when none is set. */
  monthlyUsd: number | null;
  /** Alert when spend reaches this share of the budget (1–100). */
  alertAtPct: number;
  /** Where the budget came from: saved in the dashboard, or the MASTYF_AI_COST_BUDGET_USD variable. */
  source: 'dashboard' | 'env' | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

const DEFAULT_ALERT_PCT = 80;

function budgetFile(tenantId: string): string {
  return join(tenantDir(tenantId), 'cost-budget.json');
}

function envMonthlyBudget(): number | null {
  const raw = process.env['MASTYF_AI_COST_BUDGET_USD'];
  if (!raw) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function readCostBudget(tenantId: string): CostBudgetSettings {
  const file = budgetFile(tenantId);
  if (existsSync(file)) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as Partial<CostBudgetSettings>;
      if (typeof saved.monthlyUsd === 'number' && saved.monthlyUsd > 0) {
        return {
          monthlyUsd: saved.monthlyUsd,
          alertAtPct: clampPct(saved.alertAtPct),
          source: 'dashboard',
          updatedAt: saved.updatedAt ?? null,
          updatedBy: saved.updatedBy ?? null,
        };
      }
    } catch {
      /* unreadable file: fall through to the environment */
    }
  }
  const env = envMonthlyBudget();
  return {
    monthlyUsd: env,
    alertAtPct: DEFAULT_ALERT_PCT,
    source: env != null ? 'env' : null,
    updatedAt: null,
    updatedBy: null,
  };
}

function clampPct(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_ALERT_PCT;
  return Math.min(100, Math.max(1, Math.round(n)));
}

/** Save a budget, or clear it with monthlyUsd: null. */
export function writeCostBudget(
  tenantId: string,
  input: { monthlyUsd: number | null; alertAtPct?: number },
  updatedBy: string | null,
): CostBudgetSettings {
  const monthly = input.monthlyUsd;
  if (monthly !== null && (!Number.isFinite(monthly) || monthly <= 0 || monthly > 10_000_000)) {
    throw new Error('The monthly budget must be a positive amount in US dollars.');
  }
  mkdirSync(tenantDir(tenantId), { recursive: true });
  writeFileSync(
    budgetFile(tenantId),
    JSON.stringify(
      { monthlyUsd: monthly, alertAtPct: clampPct(input.alertAtPct), updatedAt: new Date().toISOString(), updatedBy },
      null,
      2,
    ),
    'utf8',
  );
  return readCostBudget(tenantId);
}

/** The monthly budget pro-rated to a reporting window (30-day month). */
export function budgetForWindow(monthlyUsd: number | null, windowDays: number): number | null {
  if (monthlyUsd == null || !(windowDays > 0)) return null;
  return Math.round(((monthlyUsd * windowDays) / 30) * 10_000) / 10_000;
}

// ── Policy history ──────────────────────────────────────────────────────────

export interface PolicyVersion {
  id: string;
  savedAt: string;
  savedBy: string | null;
  sha256: string;
  bytes: number;
  ruleCount: number | null;
  mode: string | null;
  /** "save" from the editor, "rule-change" (a rule switched on/off or deleted), "restore" of an earlier version, or "before-first-save" (the file as it was). */
  reason: 'save' | 'rule-change' | 'restore' | 'before-first-save';
}

function historyDir(tenantId: string): string {
  return join(tenantDir(tenantId), 'policy-history');
}

function describeYaml(yaml: string): { ruleCount: number | null; mode: string | null } {
  try {
    const doc = load(yaml) as { policy?: { mode?: string; rules?: unknown[] } } | null;
    return {
      ruleCount: Array.isArray(doc?.policy?.rules) ? doc!.policy!.rules!.length : null,
      mode: typeof doc?.policy?.mode === 'string' ? doc.policy.mode : null,
    };
  } catch {
    return { ruleCount: null, mode: null };
  }
}

const ID_RE = /^\d{8}T\d{9}Z-[a-f0-9]{8}$/;

/** Store a version. Skips it when it is identical to the newest stored version. */
export function recordPolicyVersion(
  tenantId: string,
  yaml: string,
  savedBy: string | null,
  reason: PolicyVersion['reason'],
): PolicyVersion | null {
  const sha256 = createHash('sha256').update(yaml).digest('hex');
  const latest = listPolicyVersions(tenantId)[0];
  if (latest && latest.sha256 === sha256) return null;
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:.]/g, '').replace(/(\d{8}T\d{6})(\d{3})Z/, '$1$2Z');
  const id = `${stamp}-${sha256.slice(0, 8)}`;
  const dir = historyDir(tenantId);
  mkdirSync(dir, { recursive: true });
  const meta: PolicyVersion = {
    id,
    savedAt: now.toISOString(),
    savedBy,
    sha256,
    bytes: Buffer.byteLength(yaml, 'utf8'),
    ...describeYaml(yaml),
    reason,
  };
  writeFileSync(join(dir, `${id}.yaml`), yaml, 'utf8');
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}

/** Newest first. */
export function listPolicyVersions(tenantId: string, limit = 200): PolicyVersion[] {
  const dir = historyDir(tenantId);
  if (!existsSync(dir)) return [];
  const out: PolicyVersion[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const meta = JSON.parse(readFileSync(join(dir, f), 'utf8')) as PolicyVersion;
      if (ID_RE.test(meta.id)) out.push(meta);
    } catch {
      /* skip unreadable entries */
    }
  }
  return out.sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, limit);
}

export function readPolicyVersion(tenantId: string, id: string): { meta: PolicyVersion; yaml: string } | null {
  if (!ID_RE.test(id)) return null;
  const dir = historyDir(tenantId);
  const yamlPath = join(dir, `${id}.yaml`);
  const metaPath = join(dir, `${id}.json`);
  if (!existsSync(yamlPath) || !existsSync(metaPath)) return null;
  return {
    meta: JSON.parse(readFileSync(metaPath, 'utf8')) as PolicyVersion,
    yaml: readFileSync(yamlPath, 'utf8'),
  };
}

/**
 * Record a policy edit made outside the editor (switching a rule on or off, deleting a rule):
 * keeps the file as it was if history is empty, then the new version. Never throws.
 */
export function recordPolicyEdit(
  tenantId: string,
  beforeYaml: string,
  afterYaml: string,
  savedBy: string | null,
): string | null {
  try {
    if (listPolicyVersions(tenantId, 1).length === 0) {
      recordPolicyVersion(tenantId, beforeYaml, null, 'before-first-save');
    }
    return recordPolicyVersion(tenantId, afterYaml, savedBy, 'rule-change')?.id ?? null;
  } catch {
    return null;
  }
}
