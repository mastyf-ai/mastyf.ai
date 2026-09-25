/**
 * Dashboard-triggered semantic tribunal batch jobs (per-tenant).
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';
import { resolveTenantSwarmDir } from '../tenant/swarm-tenant-paths.js';
import { broadcastDashboardEvent } from './dashboard-events.js';
import { REPO_ROOT } from './swarm-artifacts.js';
const SCRIPT = join(REPO_ROOT, 'scripts', 'learning', 'run-tribunal-batch.ts');
const watchedTenants = new Set();
const runningPids = new Map();
let watchTimer = null;
function swarmDir(tenantId) {
    return resolveTenantSwarmDir(tenantId);
}
function jobPath(tenantId) {
    return join(swarmDir(tenantId), 'tribunal-job.json');
}
function logPath(tenantId) {
    return join(swarmDir(tenantId), 'tribunal-job.log');
}
function reportPath(tenantId) {
    return join(swarmDir(tenantId), 'tribunal-report.json');
}
function loadJob(tenantId) {
    const p = jobPath(tenantId);
    if (!existsSync(p))
        return null;
    try {
        return JSON.parse(readFileSync(p, 'utf-8'));
    }
    catch {
        return null;
    }
}
function writeJob(tenantId, patch) {
    mkdirSync(swarmDir(tenantId), { recursive: true });
    const existing = loadJob(tenantId) || {};
    writeFileSync(jobPath(tenantId), JSON.stringify({ ...existing, ...patch, tenantId }, null, 2));
}
function readLogTail(tenantId, maxLines = 30) {
    const p = logPath(tenantId);
    if (!existsSync(p))
        return '';
    return readFileSync(p, 'utf-8').split('\n').filter(Boolean).slice(-maxLines).join('\n');
}
function isProcessRunning(pid) {
    if (!pid || pid <= 0)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
export function loadTribunalReport(tenantId = DEFAULT_TENANT_ID) {
    const p = reportPath(tenantId);
    if (!existsSync(p))
        return null;
    try {
        return JSON.parse(readFileSync(p, 'utf-8'));
    }
    catch {
        return null;
    }
}
export function getTribunalJobStatus(tenantId = DEFAULT_TENANT_ID) {
    const job = loadJob(tenantId);
    const pid = job?.pid != null ? Number(job.pid) : null;
    let state = job?.state || 'idle';
    if (state === 'running' && pid && !isProcessRunning(pid)) {
        state = job?.exitCode === 0 ? 'done' : 'failed';
    }
    return {
        jobId: String(job?.jobId ?? ''),
        tenantId,
        state,
        phase: String(job?.phase ?? ''),
        phaseLabel: String(job?.phaseLabel ?? ''),
        progressPct: Number(job?.progressPct ?? 0),
        startedAt: job?.startedAt ? String(job.startedAt) : null,
        finishedAt: job?.finishedAt ? String(job.finishedAt) : null,
        exitCode: job?.exitCode != null ? Number(job.exitCode) : null,
        error: job?.error ? String(job.error) : null,
        logTail: readLogTail(tenantId),
        pid,
        debatedCount: job?.debatedCount != null ? Number(job.debatedCount) : undefined,
        remainingEligible: job?.remainingEligible != null ? Number(job.remainingEligible) : undefined,
    };
}
export function isTribunalJobRunning(tenantId = DEFAULT_TENANT_ID) {
    return getTribunalJobStatus(tenantId).state === 'running';
}
function finishJob(tenantId, exitCode, error) {
    writeJob(tenantId, {
        state: exitCode === 0 ? 'done' : 'failed',
        phase: exitCode === 0 ? 'done' : 'failed',
        phaseLabel: exitCode === 0 ? 'Complete' : 'Failed',
        progressPct: exitCode === 0 ? 100 : 0,
        finishedAt: new Date().toISOString(),
        exitCode,
        error: error || null,
        pid: null,
    });
    runningPids.delete(tenantId);
    watchedTenants.delete(tenantId);
    broadcastDashboardEvent({
        type: exitCode === 0 ? 'tribunal:done' : 'tribunal:failed',
        tenantId,
        payload: { tenantId, exitCode, error },
        timestamp: Date.now(),
    });
    if (watchedTenants.size === 0 && watchTimer) {
        clearInterval(watchTimer);
        watchTimer = null;
    }
}
function tickWatchers() {
    for (const tenantId of [...watchedTenants]) {
        const pid = runningPids.get(tenantId);
        if (pid && isProcessRunning(pid))
            continue;
        const job = loadJob(tenantId);
        if (job?.state === 'running') {
            finishJob(tenantId, Number(job.exitCode ?? 1), String(job.error || 'Process exited'));
        }
    }
}
function startWatcher(tenantId, pid) {
    watchedTenants.add(tenantId);
    runningPids.set(tenantId, pid);
    if (!watchTimer) {
        watchTimer = setInterval(tickWatchers, 1500);
    }
}
export function startTribunalJob(tenantId = DEFAULT_TENANT_ID, opts = {}) {
    if (isTribunalJobRunning(tenantId)) {
        const job = loadJob(tenantId);
        return {
            ok: false,
            error: 'Tribunal batch already running',
            status: 409,
            jobId: String(job?.jobId ?? ''),
        };
    }
    if (!existsSync(SCRIPT)) {
        return { ok: false, error: 'run-tribunal-batch.ts not found', status: 500 };
    }
    const jobId = randomUUID();
    const startedAt = new Date().toISOString();
    const outDir = swarmDir(tenantId);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(logPath(tenantId), `[${startedAt}] Starting tribunal batch\n`);
    writeJob(tenantId, {
        jobId,
        state: 'running',
        phase: 'starting',
        phaseLabel: 'Starting tribunal batch',
        progressPct: 5,
        startedAt,
        finishedAt: null,
        exitCode: null,
        error: null,
        pid: null,
    });
    broadcastDashboardEvent({
        type: 'tribunal:started',
        tenantId,
        payload: { jobId, startedAt, tenantId },
        timestamp: Date.now(),
    });
    const limit = opts.limit ?? 10;
    const child = spawn('node', ['--import', 'tsx/esm', SCRIPT], {
        cwd: REPO_ROOT,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            ...process.env,
            MASTYF_AI_TENANT_ID: tenantId,
            TRIBUNAL_BATCH_LIMIT: String(limit),
            TRIBUNAL_USE_LLM: opts.useLlm ? 'true' : 'false',
        },
    });
    child.stdout?.on('data', (chunk) => {
        appendFileSync(logPath(tenantId), chunk.toString());
    });
    child.stderr?.on('data', (chunk) => {
        appendFileSync(logPath(tenantId), chunk.toString());
    });
    child.on('exit', (code) => {
        const job = loadJob(tenantId);
        if (job?.state === 'done' || job?.state === 'failed')
            return;
        finishJob(tenantId, code ?? 1, code === 0 ? undefined : `Tribunal exited ${code}`);
    });
    child.unref();
    writeJob(tenantId, { pid: child.pid ?? null, progressPct: 15 });
    if (child.pid)
        startWatcher(tenantId, child.pid);
    return { ok: true, jobId, startedAt };
}
/** Test helper — reset watcher state. */
export function resetTribunalRunnerForTests() {
    watchedTenants.clear();
    runningPids.clear();
    if (watchTimer) {
        clearInterval(watchTimer);
        watchTimer = null;
    }
}
//# sourceMappingURL=tribunal-runner.js.map