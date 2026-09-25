/**
 * Rug-pull event persistence — stores detected tool-definition drift events
 * for dashboard surfacing, review workflow, and audit compliance.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
function stateDir() {
    return join(homedir(), '.mastyf-ai');
}
function statePath() {
    const dir = stateDir();
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    return join(dir, 'rug-pull-events.jsonl');
}
export function persistRugPullEvent(event) {
    const record = {
        ...event,
        id: randomUUID(),
        detectedAt: new Date().toISOString(),
        status: 'pending',
    };
    try {
        appendFileSync(statePath(), JSON.stringify(record) + '\n', 'utf-8');
    }
    catch {
        // Non-fatal — the event is still counted in Prometheus and structured logs
    }
    return record;
}
function readAllEvents() {
    const path = statePath();
    if (!existsSync(path))
        return [];
    try {
        return readFileSync(path, 'utf-8')
            .split('\n')
            .filter(Boolean)
            .map((l) => {
            try {
                return JSON.parse(l);
            }
            catch {
                return null;
            }
        })
            .filter((e) => e !== null);
    }
    catch {
        return [];
    }
}
function writeAllEvents(events) {
    try {
        writeFileSync(statePath(), events.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
    }
    catch { /* noop */ }
}
export function listRugPullEvents(opts) {
    const since = opts?.windowHours
        ? Date.now() - opts.windowHours * 3600_000
        : 0;
    let events = readAllEvents().filter((e) => {
        if (opts?.tenantId && e.tenantId !== opts.tenantId)
            return false;
        if (opts?.serverName && e.serverName !== opts.serverName)
            return false;
        if (opts?.status && e.status !== opts.status)
            return false;
        if (since > 0 && new Date(e.detectedAt).getTime() < since)
            return false;
        return true;
    });
    events.sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime());
    return opts?.limit ? events.slice(0, opts.limit) : events;
}
export function countRugPullEvents(opts) {
    return listRugPullEvents(opts).length;
}
export function updateRugPullEvent(id, updates) {
    const events = readAllEvents();
    let found = false;
    for (const e of events) {
        if (e.id === id) {
            if (updates.status)
                e.status = updates.status;
            if (updates.reviewedBy)
                e.reviewedBy = updates.reviewedBy;
            e.reviewedAt = new Date().toISOString();
            found = true;
            break;
        }
    }
    if (found)
        writeAllEvents(events);
    return found;
}
export function clearRugPullEvents(serverName) {
    if (!serverName) {
        try {
            writeFileSync(statePath(), '', 'utf-8');
        }
        catch { /* noop */ }
        return;
    }
    const events = readAllEvents().filter(e => e.serverName !== serverName);
    writeAllEvents(events);
}
export function getRugPullStatus() {
    const events = readAllEvents();
    const unreviewed = events.filter(e => e.status === 'pending').length;
    const pending = events.filter(e => e.status === 'pending');
    const serverSet = new Set(pending.map(e => e.serverName));
    const lastEvent = events.length > 0 ? events[0].detectedAt : null;
    const serverStatuses = {};
    for (const e of events) {
        if (!serverStatuses[e.serverName]) {
            serverStatuses[e.serverName] = { pending: 0, reviewed: 0, lastEvent: e.detectedAt };
        }
        if (e.status === 'pending')
            serverStatuses[e.serverName].pending++;
        else
            serverStatuses[e.serverName].reviewed++;
    }
    return {
        unreviewed,
        total: events.length,
        activeBlockedServers: Array.from(serverSet),
        lastDetected: lastEvent,
        serverStatuses,
    };
}
//# sourceMappingURL=rug-pull-store.js.map