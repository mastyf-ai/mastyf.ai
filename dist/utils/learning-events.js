/**
 * Unified Autopilot learning event log (tenant swarm dir).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { resolveTenantSwarmDir } from '../tenant/swarm-tenant-paths.js';
import { validateTenantId, DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';
function eventsPath(tenantId) {
    const tid = validateTenantId(tenantId || DEFAULT_TENANT_ID);
    return join(resolveTenantSwarmDir(tid), 'learning-events.jsonl');
}
export function appendLearningEvent(event, tenantId) {
    const path = eventsPath(tenantId);
    mkdirSync(dirname(path), { recursive: true });
    const line = {
        schemaVersion: '2026-05-1',
        timestamp: event.timestamp || new Date().toISOString(),
        type: event.type,
        detail: event.detail,
        fingerprint: event.fingerprint,
        confidence: event.confidence,
        tenantId: tenantId || DEFAULT_TENANT_ID,
        metadata: event.metadata,
    };
    appendFileSync(path, JSON.stringify(line) + '\n', 'utf-8');
}
export function readRecentLearningEvents(tenantId, limit = 50) {
    const path = eventsPath(tenantId);
    if (!existsSync(path))
        return [];
    try {
        const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
        const out = [];
        for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
            try {
                out.push(JSON.parse(lines[i]));
            }
            catch {
                /* skip */
            }
        }
        return out;
    }
    catch {
        return [];
    }
}
export function countLearningEventsSince(type, sinceMs, tenantId) {
    const cutoff = Date.now() - sinceMs;
    return readRecentLearningEvents(tenantId, 500).filter((e) => e.type === type && Date.parse(e.timestamp) >= cutoff).length;
}
//# sourceMappingURL=learning-events.js.map