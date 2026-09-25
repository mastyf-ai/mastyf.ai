/**
 * SOC2-style dashboard API access logging (per-tenant JSONL).
 */
import { appendFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ensureTenantAuditDir, resolveTenantAccessLogJsonl, resolveTenantAuditDir, resolveTenantSessionAuditJsonl, } from './tenant-audit-paths.js';
function appendJsonl(path, record) {
    try {
        appendFileSync(path, `${JSON.stringify(record)}\n`, { flag: 'a' });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        void import('../utils/logger.js').then(({ Logger }) => {
            Logger.debug(`[audit] append skipped (${path}): ${msg}`);
        });
    }
}
export function appendDashboardAccessLog(entry) {
    ensureTenantAuditDir(entry.tenantId);
    const endpoint = entry.endpoint ?? entry.path;
    const record = {
        ...entry,
        endpoint,
        path: entry.path ?? endpoint,
        timestamp: new Date().toISOString(),
    };
    appendJsonl(resolveTenantAccessLogJsonl(entry.tenantId), record);
    void import('../utils/audit-hash-chain.js').then(({ appendSiemChainedEvent }) => {
        appendSiemChainedEvent('dashboard_access', record);
    });
}
export function appendSessionRotateAudit(entry) {
    ensureTenantAuditDir(entry.tenantId);
    appendJsonl(resolveTenantSessionAuditJsonl(entry.tenantId), {
        event: 'session_rotate',
        timestamp: new Date().toISOString(),
        tenantId: entry.tenantId,
        oldTokenPrefix: entry.oldToken.slice(0, 12),
        newTokenPrefix: entry.newToken.slice(0, 12),
    });
}
export function readDashboardAccessLog(tenantId, limit = 200) {
    const path = resolveTenantAccessLogJsonl(tenantId);
    try {
        if (!existsSync(path))
            return [];
        const lines = readFileSync(path, 'utf-8').trim().split('\n').filter(Boolean);
        return lines.slice(-limit).map((l) => JSON.parse(l));
    }
    catch {
        return [];
    }
}
export function readTenantAuditJsonl(tenantId, fileName, opts) {
    const path = join(resolveTenantAuditDir(tenantId), fileName);
    if (!existsSync(path))
        return [];
    const limit = opts?.limit ?? 500;
    const start = opts?.startTime ? Date.parse(opts.startTime) : 0;
    const end = opts?.endTime ? Date.parse(opts.endTime) : Number.MAX_SAFE_INTEGER;
    try {
        const lines = readFileSync(path, 'utf-8').trim().split('\n').filter(Boolean);
        const rows = [];
        for (const line of lines) {
            const row = JSON.parse(line);
            const ts = row.timestamp ? Date.parse(row.timestamp) : 0;
            if (ts >= start && ts <= end)
                rows.push(row);
        }
        return rows.slice(-limit);
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=dashboard-access-log.js.map