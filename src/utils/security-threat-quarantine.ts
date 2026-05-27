/**
 * Persist quarantined Threat Monitor rows (semantic / blocked traffic), separate from CVE threat-intel.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { guardianHomeDir } from '../audit/tenant-audit-paths.js';
import { DEFAULT_TENANT_ID, resolveTenantId } from '../tenant/resolve-tenant.js';
import type { SecurityThreatRow } from './security-dashboard.js';

export type SecurityQuarantineRecord = SecurityThreatRow & {
  threatKey: string;
  quarantinedAt: string;
  operator?: string;
  note?: string;
  appliedRuleName?: string;
  policyPath?: string;
  enforcementStatus: 'applied' | 'already_present' | 'already_blocked' | 'no_context' | 'skipped';
  enforcementDetail?: string;
  sourceKind: 'semantic' | 'block' | 'unknown';
};

type QuarantineState = {
  entries: SecurityQuarantineRecord[];
};

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function statePath(tenantId?: string): string {
  const tid = tenantId || resolveTenantId();
  const base = guardianHomeDir();
  if (tid === DEFAULT_TENANT_ID) {
    return `${base}/security-threat-quarantine.json`;
  }
  return `${base}/tenants/${tid}/security-threat-quarantine.json`;
}

function loadState(tenantId?: string): QuarantineState {
  const path = statePath(tenantId);
  if (!existsSync(path)) return { entries: [] };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as QuarantineState;
    return { entries: Array.isArray(raw.entries) ? raw.entries : [] };
  } catch {
    return { entries: [] };
  }
}

function saveState(tenantId: string | undefined, state: QuarantineState): void {
  const path = statePath(tenantId);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8');
}

function purgeExpired(entries: SecurityQuarantineRecord[]): SecurityQuarantineRecord[] {
  const cutoff = Date.now() - RETENTION_MS;
  return entries.filter((e) => {
    const t = Date.parse(e.quarantinedAt);
    return Number.isFinite(t) && t >= cutoff;
  });
}

export class SecurityThreatQuarantine {
  private tenantId: string | undefined;

  constructor(tenantId?: string) {
    this.tenantId = tenantId;
  }

  private read(): QuarantineState {
    const state = loadState(this.tenantId);
    const entries = purgeExpired(state.entries);
    if (entries.length !== state.entries.length) {
      saveState(this.tenantId, { entries });
    }
    return { entries };
  }

  isQuarantined(threatKey: string): boolean {
    return this.read().entries.some((e) => e.threatKey === threatKey);
  }

  quarantinedKeys(): Set<string> {
    return new Set(this.read().entries.map((e) => e.threatKey));
  }

  quarantine(
    row: SecurityThreatRow & { threatKey: string },
    operator?: string,
    note?: string,
    meta?: {
      appliedRuleName?: string;
      policyPath?: string;
      enforcementStatus?: SecurityQuarantineRecord['enforcementStatus'];
      enforcementDetail?: string;
      sourceKind?: SecurityQuarantineRecord['sourceKind'];
    },
  ): { ok: boolean; error?: string; record?: SecurityQuarantineRecord } {
    if (!row.threatKey) {
      return { ok: false, error: 'threatKey required' };
    }
    const state = this.read();
    if (state.entries.some((e) => e.threatKey === row.threatKey)) {
      return { ok: true, record: state.entries.find((e) => e.threatKey === row.threatKey) };
    }
    const record: SecurityQuarantineRecord = {
      ...row,
      status: 'resolved',
      quarantinedAt: new Date().toISOString(),
      operator,
      note,
      appliedRuleName: meta?.appliedRuleName,
      policyPath: meta?.policyPath,
      enforcementStatus: meta?.enforcementStatus || 'skipped',
      enforcementDetail: meta?.enforcementDetail,
      sourceKind: meta?.sourceKind || 'unknown',
    };
    state.entries.unshift(record);
    saveState(this.tenantId, state);
    return { ok: true, record };
  }

  quarantineMany(
    rows: Array<SecurityThreatRow & { threatKey: string }>,
    operator?: string,
  ): { ok: boolean; quarantined: number } {
    let count = 0;
    for (const row of rows) {
      const wasQuarantined = this.isQuarantined(row.threatKey);
      const res = this.quarantine(row, operator);
      if (res.ok && !wasQuarantined) count++;
    }
    return { ok: true, quarantined: count };
  }

  restore(threatKey: string): { ok: boolean; error?: string; record?: SecurityQuarantineRecord } {
    const state = this.read();
    const idx = state.entries.findIndex(
      (e) => e.threatKey === threatKey || e.id === threatKey,
    );
    if (idx < 0) return { ok: false, error: 'Not in quarantine' };
    const [record] = state.entries.splice(idx, 1);
    saveState(this.tenantId, state);
    return { ok: true, record };
  }

  list(days = 30): SecurityQuarantineRecord[] {
    const maxDays = Math.min(Math.max(days, 1), 365);
    const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;
    return this.read().entries.filter((e) => {
      const t = Date.parse(e.quarantinedAt);
      return Number.isFinite(t) && t >= cutoff;
    });
  }

  /** Resolve a quarantined row by stable threatKey and/or display id. */
  findEntry(
    days = 30,
    opts: { threatKey?: string; id?: string },
  ): SecurityQuarantineRecord | undefined {
    const entries = this.list(days);
    const rawKey = opts.threatKey?.trim();
    const rawId = opts.id?.trim();
    if (rawKey) {
      let decoded = rawKey;
      try {
        decoded = decodeURIComponent(rawKey);
      } catch {
        /* keep raw */
      }
      const match = entries.find(
        (e) =>
          e.threatKey === rawKey
          || e.threatKey === decoded
          || e.id === rawKey
          || e.id === decoded,
      );
      if (match) return match;
    }
    if (rawId) {
      return entries.find((e) => e.id === rawId || e.threatKey === rawId);
    }
    return undefined;
  }
}

const cache = new Map<string, SecurityThreatQuarantine>();

export function getSecurityThreatQuarantine(tenantId?: string): SecurityThreatQuarantine {
  const tid = tenantId || resolveTenantId();
  let q = cache.get(tid);
  if (!q) {
    q = new SecurityThreatQuarantine(tid);
    cache.set(tid, q);
  }
  return q;
}

/** @internal test helper */
export function resetSecurityThreatQuarantineForTests(): void {
  cache.clear();
}
