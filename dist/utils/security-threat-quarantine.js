/**
 * Persist quarantined Threat Monitor rows (semantic / blocked traffic), separate from CVE threat-intel.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { mastyfAiHomeDir } from '../audit/tenant-audit-paths.js';
import { DEFAULT_TENANT_ID, resolveTenantId } from '../tenant/resolve-tenant.js';
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
function statePath(tenantId) {
    const tid = tenantId || resolveTenantId();
    const base = mastyfAiHomeDir();
    if (tid === DEFAULT_TENANT_ID) {
        return `${base}/security-threat-quarantine.json`;
    }
    return `${base}/tenants/${tid}/security-threat-quarantine.json`;
}
function loadState(tenantId) {
    const path = statePath(tenantId);
    if (!existsSync(path))
        return { entries: [] };
    try {
        const raw = JSON.parse(readFileSync(path, 'utf-8'));
        return { entries: Array.isArray(raw.entries) ? raw.entries : [] };
    }
    catch {
        return { entries: [] };
    }
}
function saveState(tenantId, state) {
    const path = statePath(tenantId);
    const dir = dirname(path);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8');
}
function purgeExpired(entries) {
    const cutoff = Date.now() - RETENTION_MS;
    return entries.filter((e) => {
        const t = Date.parse(e.quarantinedAt);
        return Number.isFinite(t) && t >= cutoff;
    });
}
export class SecurityThreatQuarantine {
    tenantId;
    constructor(tenantId) {
        this.tenantId = tenantId;
    }
    read() {
        const state = loadState(this.tenantId);
        const entries = purgeExpired(state.entries);
        if (entries.length !== state.entries.length) {
            saveState(this.tenantId, { entries });
        }
        return { entries };
    }
    isQuarantined(threatKey) {
        return this.read().entries.some((e) => e.threatKey === threatKey);
    }
    quarantinedKeys() {
        return new Set(this.read().entries.map((e) => e.threatKey));
    }
    quarantine(row, operator, note, meta) {
        if (!row.threatKey) {
            return { ok: false, error: 'threatKey required' };
        }
        const state = this.read();
        if (state.entries.some((e) => e.threatKey === row.threatKey)) {
            return { ok: true, record: state.entries.find((e) => e.threatKey === row.threatKey) };
        }
        const record = {
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
    quarantineMany(rows, operator) {
        let count = 0;
        for (const row of rows) {
            const wasQuarantined = this.isQuarantined(row.threatKey);
            const res = this.quarantine(row, operator);
            if (res.ok && !wasQuarantined)
                count++;
        }
        return { ok: true, quarantined: count };
    }
    restore(threatKey) {
        const group = this.restoreGroup(threatKey);
        if (!group.ok)
            return { ok: false, error: group.error };
        return { ok: true, record: group.records?.[0] };
    }
    /**
     * Restore every quarantined row that shares type+source with the anchor threat.
     * Matches bulk quarantine, which archives all underlying rows for a fingerprint.
     */
    restoreGroup(threatKey) {
        const state = this.read();
        const anchor = state.entries.find((e) => e.threatKey === threatKey || e.id === threatKey);
        if (!anchor)
            return { ok: false, error: 'Not in quarantine' };
        const fingerprint = `${anchor.type}:${anchor.source}`;
        const removed = [];
        const kept = [];
        for (const entry of state.entries) {
            if (`${entry.type}:${entry.source}` === fingerprint) {
                removed.push(entry);
            }
            else {
                kept.push(entry);
            }
        }
        if (removed.length === 0)
            return { ok: false, error: 'Not in quarantine' };
        saveState(this.tenantId, { entries: kept });
        return { ok: true, records: removed, restored: removed.length };
    }
    list(days = 30) {
        const maxDays = Math.min(Math.max(days, 1), 365);
        const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;
        return this.read().entries.filter((e) => {
            const t = Date.parse(e.quarantinedAt);
            return Number.isFinite(t) && t >= cutoff;
        });
    }
    /** Resolve a quarantined row by stable threatKey and/or display id. */
    findEntry(days = 30, opts) {
        const entries = this.list(days);
        const rawKey = opts.threatKey?.trim();
        const rawId = opts.id?.trim();
        if (rawKey) {
            let decoded = rawKey;
            try {
                decoded = decodeURIComponent(rawKey);
            }
            catch {
                /* keep raw */
            }
            const match = entries.find((e) => e.threatKey === rawKey
                || e.threatKey === decoded
                || e.id === rawKey
                || e.id === decoded);
            if (match)
                return match;
        }
        if (rawId) {
            return entries.find((e) => e.id === rawId || e.threatKey === rawId);
        }
        return undefined;
    }
}
const cache = new Map();
export function getSecurityThreatQuarantine(tenantId) {
    const tid = tenantId || resolveTenantId();
    let q = cache.get(tid);
    if (!q) {
        q = new SecurityThreatQuarantine(tid);
        cache.set(tid, q);
    }
    return q;
}
/** @internal test helper */
export function resetSecurityThreatQuarantineForTests() {
    cache.clear();
}
//# sourceMappingURL=security-threat-quarantine.js.map