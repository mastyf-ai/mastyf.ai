/**
 * Live traffic hotness counters — prioritize fuzz coverage for tools under attack.
 * Persisted under shared vuln store; API reads always merge from disk (fleet children).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ensureVulnStoreDir, vulnLiveStatsPath } from './paths.js';
const stats = new Map();
const MAX_KEYS = 500;
function statsPath() {
    return vulnLiveStatsPath();
}
function keyOf(serverName, toolName) {
    return `${serverName}:${toolName}`;
}
/** Merge a disk row into memory (take max counters / latest timestamp). */
function mergeRow(row) {
    const existing = stats.get(row.key);
    if (!existing) {
        stats.set(row.key, { ...row });
        return;
    }
    existing.allowCount = Math.max(existing.allowCount, row.allowCount);
    existing.maliciousShapedCount = Math.max(existing.maliciousShapedCount, row.maliciousShapedCount);
    existing.softDenyCount = Math.max(existing.softDenyCount, row.softDenyCount);
    if (row.lastSeenAt > existing.lastSeenAt)
        existing.lastSeenAt = row.lastSeenAt;
}
function loadFromDisk() {
    try {
        const p = statsPath();
        if (!existsSync(p))
            return;
        const raw = JSON.parse(readFileSync(p, 'utf8'));
        if (Array.isArray(raw)) {
            for (const row of raw.slice(-MAX_KEYS)) {
                mergeRow(row);
            }
        }
    }
    catch {
        /* ignore */
    }
}
function ensureLoaded() {
    if (stats.size > 0)
        return;
    loadFromDisk();
}
/** Force re-merge from disk so dashboard sees fleet child writes. */
export function reloadLiveTrafficStatsFromDisk() {
    loadFromDisk();
}
function persist() {
    try {
        ensureVulnStoreDir();
        // Reload peer writes before overwrite
        loadFromDisk();
        writeFileSync(statsPath(), JSON.stringify([...stats.values()], null, 2));
    }
    catch {
        /* best-effort */
    }
}
function bump(serverName, toolName, field) {
    ensureLoaded();
    const key = keyOf(serverName, toolName);
    let row = stats.get(key);
    if (!row) {
        if (stats.size >= MAX_KEYS) {
            const oldest = [...stats.values()].sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt))[0];
            if (oldest)
                stats.delete(oldest.key);
        }
        row = {
            key,
            serverName,
            toolName,
            allowCount: 0,
            maliciousShapedCount: 0,
            softDenyCount: 0,
            lastSeenAt: new Date().toISOString(),
        };
        stats.set(key, row);
    }
    row[field]++;
    row.lastSeenAt = new Date().toISOString();
    persist();
}
export function recordLiveAllow(serverName, toolName) {
    bump(serverName, toolName, 'allowCount');
}
export function recordMaliciousShaped(serverName, toolName) {
    bump(serverName, toolName, 'maliciousShapedCount');
}
export function recordSoftDenySeen(serverName, toolName) {
    bump(serverName, toolName, 'softDenyCount');
}
export function getLiveTrafficStats() {
    reloadLiveTrafficStatsFromDisk();
    return [...stats.values()].sort((a, b) => b.maliciousShapedCount - a.maliciousShapedCount
        || b.allowCount - a.allowCount);
}
export function hotnessScore(serverName, toolName) {
    reloadLiveTrafficStatsFromDisk();
    const row = stats.get(keyOf(serverName, toolName));
    if (!row)
        return 0;
    return row.maliciousShapedCount * 10 + row.allowCount + row.softDenyCount * 2;
}
/** Sort tools so hottest (for this server) come first. */
export function sortToolsByLiveHotness(serverName, tools) {
    return [...tools].sort((a, b) => hotnessScore(serverName, b.name) - hotnessScore(serverName, a.name));
}
export function resetLiveTrafficStatsForTests() {
    stats.clear();
}
//# sourceMappingURL=live-traffic-stats.js.map