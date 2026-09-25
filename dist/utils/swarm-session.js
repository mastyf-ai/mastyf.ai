/**
 * Dashboard session boundaries for swarm / batch artifacts.
 * Strict live mode hides committed or stale swarm files unless a job started
 * after this dashboard process booted.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DEFAULT_TENANT_ID, validateTenantId } from '../tenant/resolve-tenant.js';
import { LEGACY_SWARM_DIR, resolveTenantSwarmDir } from '../tenant/swarm-tenant-paths.js';
const JOB_FILES = ['job.json', 'threat-lab-job.json', 'auto-research-job.json'];
const ARTIFACT_MTIME_GRACE_MS = 60_000;
/** Cumulative audit manifests — not tied to the latest job output window. */
const CUMULATIVE_TENANT_ARTIFACTS = new Set([
    'auto-corpus-manifest.json',
    'threat-lab-candidates.json',
]);
/** Set when dashboard-server (or tests) initialize the session clock. */
export let dashboardSessionStartedMs = Date.now();
export function resetDashboardSessionForTests(at) {
    dashboardSessionStartedMs = at ?? Date.now();
}
/** Default true — set MASTYF_AI_DASHBOARD_STRICT_LIVE=false to disable session gating. */
export function isStrictLiveDashboard() {
    return process.env.MASTYF_AI_DASHBOARD_STRICT_LIVE !== 'false';
}
export function isLegacyArtifactsAllowed() {
    return process.env.MASTYF_AI_SWARM_USE_LEGACY_ARTIFACTS === 'true';
}
function parseJobFile(path) {
    if (!existsSync(path))
        return null;
    try {
        const job = JSON.parse(readFileSync(path, 'utf-8'));
        if (!job.startedAt)
            return null;
        const startedAtMs = Date.parse(job.startedAt);
        if (Number.isNaN(startedAtMs))
            return null;
        return { startedAtMs, state: String(job.state ?? 'idle') };
    }
    catch {
        return null;
    }
}
function tenantJobPaths(tenantId) {
    const dir = resolveTenantSwarmDir(validateTenantId(tenantId));
    return JOB_FILES.map((name) => join(dir, name));
}
/** Latest completed/running/failed job in tenant dir (survives dashboard restarts). */
function getLatestTenantJob(tenantId) {
    let latest = null;
    for (const p of tenantJobPaths(tenantId)) {
        const job = parseJobFile(p);
        if (!job)
            continue;
        if (!['running', 'done', 'failed'].includes(job.state))
            continue;
        if (!latest || job.startedAtMs > latest.startedAtMs)
            latest = job;
    }
    return latest;
}
function isTenantSwarmPath(filePath, tenantId) {
    const tenantDir = resolveTenantSwarmDir(tenantId);
    return filePath.startsWith(`${tenantDir}/`) || filePath === tenantDir;
}
/** Earliest job start time in this dashboard session, if any. */
export function getSessionJobStartedMs(tenantId) {
    let earliest = null;
    for (const p of tenantJobPaths(tenantId)) {
        const job = parseJobFile(p);
        if (!job || job.startedAtMs < dashboardSessionStartedMs)
            continue;
        if (earliest == null || job.startedAtMs < earliest)
            earliest = job.startedAtMs;
    }
    return earliest;
}
export function hasRunningSessionJob(tenantId) {
    for (const p of tenantJobPaths(tenantId)) {
        const job = parseJobFile(p);
        if (!job)
            continue;
        if (job.state === 'running' && job.startedAtMs >= dashboardSessionStartedMs)
            return true;
    }
    return false;
}
/** True when a swarm / threat-discovery job ran (or is running) this dashboard session. */
export function isSwarmSessionActiveForTenant(tenantId) {
    if (!isStrictLiveDashboard())
        return true;
    if (getSessionJobStartedMs(tenantId) != null || hasRunningSessionJob(tenantId))
        return true;
    // Tenant-scoped artifacts remain visible after dashboard restart (unlike legacy CI dir).
    return getLatestTenantJob(tenantId) != null;
}
export function isLegacySwarmPath(filePath) {
    return filePath.startsWith(`${LEGACY_SWARM_DIR}/`) || filePath === LEGACY_SWARM_DIR;
}
/**
 * Whether a swarm artifact file may be exposed on the dashboard.
 * Legacy committed dir requires opt-in env AND an active session job.
 */
export function isSwarmArtifactVisibleForSession(filePath, tenantId) {
    if (!isStrictLiveDashboard())
        return true;
    const tid = validateTenantId(tenantId?.trim() || DEFAULT_TENANT_ID);
    // Per-tenant dir: show artifacts from the latest tenant job (not gated by process boot time).
    if (isTenantSwarmPath(filePath, tid)) {
        const job = getLatestTenantJob(tid);
        if (!job)
            return false;
        if (CUMULATIVE_TENANT_ARTIFACTS.has(basename(filePath))) {
            return true;
        }
        try {
            return statSync(filePath).mtimeMs >= job.startedAtMs - ARTIFACT_MTIME_GRACE_MS;
        }
        catch {
            return false;
        }
    }
    if (isLegacySwarmPath(filePath)) {
        if (!isLegacyArtifactsAllowed())
            return false;
    }
    const sessionStart = getSessionJobStartedMs(tid);
    if (sessionStart == null) {
        return hasRunningSessionJob(tid);
    }
    try {
        return statSync(filePath).mtimeMs >= sessionStart - ARTIFACT_MTIME_GRACE_MS;
    }
    catch {
        return false;
    }
}
export function swarmDataProvenance(tenantId) {
    const strictLive = isStrictLiveDashboard();
    const sessionActive = isSwarmSessionActiveForTenant(tenantId);
    const legacyAllowed = isLegacyArtifactsAllowed();
    let source = 'none';
    if (sessionActive)
        source = 'session-swarm';
    else if (legacyAllowed && strictLive)
        source = 'none';
    else if (!strictLive)
        source = 'session-swarm';
    return { strictLive, sessionActive, legacyAllowed, source };
}
//# sourceMappingURL=swarm-session.js.map