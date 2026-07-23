/**
 * Dashboard-triggered Threat Lab and Auto Threat Research jobs (per-tenant).
 */
import { spawn } from 'node:child_process';
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';
import { broadcastDashboardEvent } from './dashboard-events.js';
import { REPO_ROOT, ensureTenantSwarmDir } from './swarm-artifacts.js';
import {
  type ThreatDiscoveryJobKind,
  loadThreatDiscoveryJob,
  patchThreatDiscoveryJob,
  readThreatDiscoveryLogTail,
  threatDiscoveryJobPath,
  threatDiscoveryLogPath,
} from './threat-discovery-job-file.js';

export type { ThreatDiscoveryJobKind };

export interface ThreatDiscoveryJobStatus {
  jobId: string;
  kind: ThreatDiscoveryJobKind;
  tenantId: string;
  state: 'idle' | 'running' | 'done' | 'failed';
  phase: string;
  phaseLabel: string;
  progressPct: number;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  error: string | null;
  logTail: string;
  pid: number | null;
}

const SCRIPTS: Record<ThreatDiscoveryJobKind, string> = {
  'threat-lab': join(REPO_ROOT, 'scripts', 'security-swarm', 'run-threat-lab.ts'),
  'auto-research': join(REPO_ROOT, 'scripts', 'security-swarm', 'run-auto-threat-research.ts'),
};

const DISCOVERY_LOG_STALE_MS = 25 * 60 * 1000;
const DISCOVERY_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const DISCOVERY_HARD_TIMEOUT_MS = 10 * 60 * 1000; // Kill stuck jobs after 10 minutes
const OUTPUT_BASE = join(REPO_ROOT, 'reports', 'tenants', 'default', 'security-swarm');

const watchedJobs = new Set<string>();
let watchTimer: ReturnType<typeof setInterval> | null = null;
const runningPids = new Map<string, number>();
const broadcastedTerminal = new Set<string>();

function jobKey(tenantId: string, kind: ThreatDiscoveryJobKind): string {
  return `${tenantId}:${kind}`;
}

function loadJob(tenantId: string, kind: ThreatDiscoveryJobKind): Record<string, unknown> | null {
  return loadThreatDiscoveryJob(kind, tenantId);
}

function writeJob(
  tenantId: string,
  kind: ThreatDiscoveryJobKind,
  patch: Record<string, unknown>,
): void {
  patchThreatDiscoveryJob(kind, patch, tenantId);
}

function readLogTail(tenantId: string, kind: ThreatDiscoveryJobKind, maxLines = 40): string {
  return readThreatDiscoveryLogTail(kind, tenantId, maxLines);
}

function isProcessRunning(pid: number | null | undefined): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function inferJobOutcomeFromLog(
  kind: ThreatDiscoveryJobKind,
  logTail: string,
): { exitCode: number; error?: string } | null {
  if (!logTail.trim()) return null;
  if (kind === 'auto-research') {
    if (/wrote\s+\d+\s*\/\s*\d+\s+fixture\(s\)/i.test(logTail)) {
      return { exitCode: 0 };
    }
    if (/\[auto-threat-research\] disabled/i.test(logTail)) {
      return {
        exitCode: 1,
        error: 'Auto research disabled — set MASTYF_AI_THREAT_RESEARCH_AUTO=true on the proxy',
      };
    }
    if (/\[auto-threat-research\] failed:/i.test(logTail)) {
      const line = logTail.split('\n').find((l) => /\[auto-threat-research\] failed:/i.test(l));
      return {
        exitCode: 1,
        error: line?.replace(/^\[auto-threat-research\] failed:\s*/i, '') || 'Auto research failed',
      };
    }
  }
  if (kind === 'threat-lab') {
    if (/\[threat-lab\] wrote \d+/i.test(logTail)) {
      return { exitCode: 0 };
    }
    if (/\[threat-lab\] skipped:/i.test(logTail)) {
      return { exitCode: 0 };
    }
    if (/\[threat-lab\] gate failed:/i.test(logTail)) {
      const line = logTail.split('\n').find((l) => /\[threat-lab\] gate failed:/i.test(l));
      return {
        exitCode: 1,
        error: line?.replace(/^\[threat-lab\] gate failed:\s*/i, '') || 'Threat Lab gate failed',
      };
    }
  }
  return null;
}

function cleanupWatcher(key: string): void {
  watchedJobs.delete(key);
  runningPids.delete(key);
  if (watchedJobs.size === 0 && watchTimer) {
    clearInterval(watchTimer);
    watchTimer = null;
  }
}

function broadcastTerminalOnce(
  tenantId: string,
  kind: ThreatDiscoveryJobKind,
  state: 'done' | 'failed',
  payload: Record<string, unknown>,
): void {
  const key = jobKey(tenantId, kind);
  const marker = `${key}:${state}:${String(payload.finishedAt ?? payload.exitCode ?? '')}`;
  if (broadcastedTerminal.has(marker)) return;
  broadcastedTerminal.add(marker);
  broadcastDashboardEvent({
    type: state === 'done' ? 'threat-discovery:done' : 'threat-discovery:failed',
    tenantId,
    payload: { kind, tenantId, ...payload },
    timestamp: Date.now(),
  });
}

/**
 * Mark orphaned discovery jobs failed/done when the child exited without updating job.json
 * (e.g. dashboard restart while a detached job was running).
 */
export function reconcileStaleThreatDiscoveryJob(
  tenantId: string,
  kind: ThreatDiscoveryJobKind,
): boolean {
  const job = loadJob(tenantId, kind);
  if (!job || job.state !== 'running') return false;

  const pid = job.pid != null ? Number(job.pid) : null;
  if (pid && isProcessRunning(pid)) return false;

  const logTail = readLogTail(tenantId, kind, 80);
  const inferred = inferJobOutcomeFromLog(kind, logTail);
  if (inferred) {
    finishJob(tenantId, kind, inferred.exitCode, inferred.error, { fromReconcile: true });
    return true;
  }

  const logPath = threatDiscoveryLogPath(kind, tenantId);
  let logMtime = 0;
  if (existsSync(logPath)) {
    try {
      logMtime = statSync(logPath).mtimeMs;
    } catch {
      /* ignore */
    }
  }
  const startedAt = job.startedAt ? Date.parse(String(job.startedAt)) : 0;
  const now = Date.now();
  const logStale = logMtime > 0 && now - logMtime > DISCOVERY_LOG_STALE_MS;
  const ageStale = startedAt > 0 && now - startedAt > DISCOVERY_MAX_AGE_MS;

  if (!logStale && !ageStale) {
    return false;
  }

  finishJob(
    tenantId,
    kind,
    Number(job.exitCode ?? 1),
    String(
      job.error
        || (logStale
          ? 'Discovery stalled with no progress for 25+ minutes — re-run from the dashboard'
          : 'Discovery exceeded maximum runtime — re-run from the dashboard'),
    ),
    { fromReconcile: true },
  );
  return true;
}

export function getThreatDiscoveryJobStatus(
  tenantId: string = DEFAULT_TENANT_ID,
  kind: ThreatDiscoveryJobKind,
): ThreatDiscoveryJobStatus {
  reconcileStaleThreatDiscoveryJob(tenantId, kind);
  const job = loadJob(tenantId, kind);
  const pid = job?.pid != null ? Number(job.pid) : null;
  const state = (job?.state as ThreatDiscoveryJobStatus['state']) || 'idle';
  return {
    jobId: String(job?.jobId ?? ''),
    kind,
    tenantId,
    state,
    phase: String(job?.phase ?? ''),
    phaseLabel: String(job?.phaseLabel ?? ''),
    progressPct: Number(job?.progressPct ?? 0),
    startedAt: job?.startedAt ? String(job.startedAt) : null,
    finishedAt: job?.finishedAt ? String(job.finishedAt) : null,
    exitCode: job?.exitCode != null ? Number(job.exitCode) : null,
    error: job?.error ? String(job.error) : null,
    logTail: readLogTail(tenantId, kind),
    pid,
  };
}

export function isThreatDiscoveryJobRunning(
  tenantId: string,
  kind: ThreatDiscoveryJobKind,
): boolean {
  const st = getThreatDiscoveryJobStatus(tenantId, kind);
  return st.state === 'running';
}

function broadcastJobEvent(
  tenantId: string,
  kind: ThreatDiscoveryJobKind,
  type: 'threat-discovery:started' | 'threat-discovery:done' | 'threat-discovery:failed',
  payload: Record<string, unknown>,
): void {
  broadcastDashboardEvent({
    type,
    tenantId,
    payload: { kind, tenantId, ...payload },
    timestamp: Date.now(),
  });
}

function finishJob(
  tenantId: string,
  kind: ThreatDiscoveryJobKind,
  exitCode: number,
  error?: string,
  opts: { fromReconcile?: boolean; skipWrite?: boolean } = {},
): void {
  const key = jobKey(tenantId, kind);
  const existing = loadJob(tenantId, kind);
  if (existing?.state === 'done' || existing?.state === 'failed') {
    cleanupWatcher(key);
    return;
  }

  const finishedAt = new Date().toISOString();
  if (!opts.skipWrite) {
    writeJob(tenantId, kind, {
      state: exitCode === 0 ? 'done' : 'failed',
      phase: exitCode === 0 ? 'done' : 'failed',
      phaseLabel: exitCode === 0 ? 'Complete' : 'Failed',
      progressPct: exitCode === 0 ? 100 : 0,
      finishedAt,
      exitCode,
      error: error || null,
      pid: null,
    });
  }

  cleanupWatcher(key);
  if (exitCode === 0) {
    broadcastTerminalOnce(tenantId, kind, 'done', { exitCode, finishedAt });
  } else {
    broadcastTerminalOnce(tenantId, kind, 'failed', { exitCode, error, finishedAt });
  }
}

function tickWatchers(): void {
  for (const key of [...watchedJobs]) {
    const [tenantId, kind] = key.split(':') as [string, ThreatDiscoveryJobKind];
    const job = loadJob(tenantId, kind);
    if (!job) {
      cleanupWatcher(key);
      continue;
    }

    const state = String(job.state);
    if (state === 'done') {
      finishJob(tenantId, kind, Number(job.exitCode ?? 0), undefined, { skipWrite: true });
      continue;
    }
    if (state === 'failed') {
      finishJob(
        tenantId,
        kind,
        Number(job.exitCode ?? 1),
        job.error ? String(job.error) : undefined,
        { skipWrite: true },
      );
      continue;
    }
    if (state !== 'running') {
      cleanupWatcher(key);
      continue;
    }

    const pid = runningPids.get(key) ?? (job.pid != null ? Number(job.pid) : null);
    if (pid && isProcessRunning(pid)) {
      const startedAt = job.startedAt ? Date.parse(String(job.startedAt)) : Date.now();
      const elapsed = Date.now() - startedAt;
      const estimatedMs = kind === 'threat-lab' ? 120000 : 60000;
      const progress = Math.min(95, 10 + Math.round((elapsed / estimatedMs) * 85));
      if (progress !== Number(job.progressPct)) {
        writeJob(tenantId, kind, { progressPct: progress });
      }
      continue;
    }

    // Process is dead — try to determine actual outcome
    const candidatePath = join(OUTPUT_BASE, 'threat-lab-candidates.json');
    const analysisPath = join(OUTPUT_BASE, 'analysis.txt');
    if (existsSync(candidatePath) || existsSync(analysisPath)) {
      finishJob(tenantId, kind, 0, undefined);
      continue;
    }
    reconcileStaleThreatDiscoveryJob(tenantId, kind);
  }
}

function startWatcher(tenantId: string, kind: ThreatDiscoveryJobKind, pid: number): void {
  const key = jobKey(tenantId, kind);
  watchedJobs.add(key);
  runningPids.set(key, pid);
  if (!watchTimer) {
    watchTimer = setInterval(tickWatchers, 1500);
  }
}

export function resumeThreatDiscoveryWatchers(tenantId: string = DEFAULT_TENANT_ID): void {
  for (const kind of ['threat-lab', 'auto-research'] as const) {
    reconcileStaleThreatDiscoveryJob(tenantId, kind);
    const job = loadJob(tenantId, kind);
    if (job?.state === 'running') {
      const pid = job.pid != null ? Number(job.pid) : null;
      if (pid && isProcessRunning(pid)) {
        startWatcher(tenantId, kind, pid);
      }
    }
  }
}

function spawnDiscoveryJob(
  tenantId: string,
  kind: ThreatDiscoveryJobKind,
  extraEnv: Record<string, string>,
): {
  ok: boolean;
  jobId?: string;
  startedAt?: string;
  error?: string;
  status?: number;
} {
  if (isThreatDiscoveryJobRunning(tenantId, kind)) {
    const job = loadJob(tenantId, kind);
    return {
      ok: false,
      error: `${kind} job already running`,
      status: 409,
      jobId: String(job?.jobId ?? ''),
    };
  }

  const script = SCRIPTS[kind];
  if (!existsSync(script)) {
    return { ok: false, error: `${kind} script not found`, status: 500 };
  }

  const jobId = randomUUID();
  const startedAt = new Date().toISOString();
  ensureTenantSwarmDir(tenantId);
  writeFileSync(threatDiscoveryLogPath(kind, tenantId), `[${startedAt}] Starting ${kind}\n`);

  writeJob(tenantId, kind, {
    jobId,
    state: 'running',
    phase: 'starting',
    phaseLabel: kind === 'threat-lab' ? 'Threat Lab discovery' : 'Auto threat research',
    progressPct: 5,
    startedAt,
    finishedAt: null,
    exitCode: null,
    error: null,
    pid: null,
  });

  broadcastJobEvent(tenantId, kind, 'threat-discovery:started', { jobId, startedAt });

  const child = spawn(process.execPath, ['--import', 'tsx/esm', script], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: {
      ...process.env,
      ...extraEnv,
      MASTYF_AI_SWARM_DIR: ensureTenantSwarmDir(tenantId),
      MASTYF_AI_TENANT_ID: tenantId,
    },
  });

  child.once('exit', (code) => {
    setTimeout(() => {
      const job = loadJob(tenantId, kind);
      if (!job || job.state !== 'running') return;
      if (job.jobId !== jobId) return;
      const logTail = readLogTail(tenantId, kind, 80);
      const inferred = inferJobOutcomeFromLog(kind, logTail);
      if (inferred) {
        finishJob(tenantId, kind, inferred.exitCode, inferred.error);
        return;
      }
      finishJob(tenantId, kind, code ?? 1, code === 0 ? undefined : `${kind} exited ${code}`);
    }, 2500);
  });

  child.unref();
  writeJob(tenantId, kind, { pid: child.pid ?? null, progressPct: 10 });
  if (child.pid) startWatcher(tenantId, kind, child.pid);

  // Auto-kill stuck jobs after hard timeout
  setTimeout(() => {
    const job = loadJob(tenantId, kind);
    if (job?.state === 'running' && job?.jobId === jobId) {
      try { child.kill('SIGTERM'); } catch {}
      finishJob(tenantId, kind, 1, `${kind} timed out after ${DISCOVERY_HARD_TIMEOUT_MS / 60000} minutes`);
    }
  }, DISCOVERY_HARD_TIMEOUT_MS);

  return { ok: true, jobId, startedAt };
}

export function startThreatLabJob(
  tenantId: string = DEFAULT_TENANT_ID,
  opts: { mode?: 'reactive' | 'proactive' } = {},
): ReturnType<typeof spawnDiscoveryJob> {
  const mode = opts.mode === 'proactive' ? 'proactive' : 'reactive';
  return spawnDiscoveryJob(tenantId, 'threat-lab', {
    SWARM_THREAT_LAB: 'true',
    SWARM_THREAT_LAB_MODE: mode,
    SWARM_THREAT_LAB_REQUIRE_LLM: process.env.SWARM_THREAT_LAB_REQUIRE_LLM ?? 'true',
  });
}

export function startAutoThreatResearchJob(
  tenantId: string = DEFAULT_TENANT_ID,
): ReturnType<typeof spawnDiscoveryJob> {
  return spawnDiscoveryJob(tenantId, 'auto-research', {
    MASTYF_AI_THREAT_RESEARCH_AUTO: 'true',
    SWARM_THREAT_RESEARCH_AUTO: 'true',
  });
}

/** Test helper — reset watcher state. */
export function resetThreatDiscoveryRunnerForTests(): void {
  watchedJobs.clear();
  runningPids.clear();
  broadcastedTerminal.clear();
  if (watchTimer) {
    clearInterval(watchTimer);
    watchTimer = null;
  }
}

resumeThreatDiscoveryWatchers(DEFAULT_TENANT_ID);
