import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
export function approvalStoreDir() {
    const home = process.env.MASTYF_AI_HOME?.trim();
    return home || join(homedir(), '.mastyf-ai');
}
function statePath() {
    const dir = approvalStoreDir();
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    return join(dir, 'approvals.jsonl');
}
function readAll() {
    const path = statePath();
    if (!existsSync(path))
        return [];
    try {
        return readFileSync(path, 'utf-8')
            .split('\n')
            .filter(Boolean)
            .flatMap((line) => {
            try {
                return [JSON.parse(line)];
            }
            catch {
                return [];
            }
        });
    }
    catch {
        return [];
    }
}
function writeAll(rows) {
    writeFileSync(statePath(), rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf-8');
}
function sameCall(a, toolName, serverName) {
    return a.toolName === toolName && a.serverName === serverName;
}
function notExpired(row, now = Date.now()) {
    return new Date(row.expiresAt).getTime() > now;
}
export function persistApprovalRequest(req) {
    appendFileSync(statePath(), JSON.stringify(req) + '\n', 'utf-8');
}
export function listPendingApprovals(tenantId) {
    return readAll()
        .filter((r) => r.status === 'pending')
        .filter((r) => !tenantId || r.tenantId === tenantId)
        .filter((r) => notExpired(r))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}
export function findPendingMatch(params) {
    return (listPendingApprovals(params.tenantId).find((r) => sameCall(r, params.toolName, params.serverName)) ||
        null);
}
/** Single-use: an `mastyf-ai approve` lets the next matching tools/call through. */
export function consumeApprovedMatch(params) {
    const rows = readAll();
    const idx = rows.findIndex((r) => r.status === 'approved' &&
        sameCall(r, params.toolName, params.serverName) &&
        (!params.tenantId || r.tenantId === params.tenantId) &&
        notExpired(r));
    if (idx < 0)
        return null;
    rows[idx] = {
        ...rows[idx],
        status: 'consumed',
        resolvedAt: rows[idx].resolvedAt || new Date().toISOString(),
    };
    writeAll(rows);
    return rows[idx];
}
export function resolveApproval(approvalId, action, resolvedBy) {
    const rows = readAll();
    let found = false;
    const updated = rows.map((r) => {
        if (r.approvalId === approvalId && r.status === 'pending') {
            found = true;
            return {
                ...r,
                status: action,
                resolvedAt: new Date().toISOString(),
                resolvedBy: resolvedBy || r.resolvedBy,
            };
        }
        return r;
    });
    if (found)
        writeAll(updated);
    return found;
}
//# sourceMappingURL=approval-store.js.map