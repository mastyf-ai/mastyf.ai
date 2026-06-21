/**
 * Dashboard-triggered security swarm analysis (detached background job, per-tenant dirs).
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';
import {
  getEffectiveSwarmDir,
  resolveTenantSwarmDir,
} from '../tenant/swarm-tenant-paths.js';
import { broadcastDashboardEvent } from './dashboard-events.js';
import { emitFlowStep } from './flow-events.js';
import {
  REPO_ROOT,
  SWARM_DIR,
  ensureTenantSwarmDir,
} from './swarm-artifacts.js';
import { isSwarmSessionActiveForTenant, isSwarmArtifactVisibleForSession } from './swarm-session.js';

const RUN_SCRIPT = join(REPO_ROOT, 'security-swarm', 'run-analysis.mjs');

export interface SwarmJobStatus {
  jobId: string;
  tenantId: string;
  state: 'idle' | 'running' | 'done' | 'failed';
  phase: string;
  phaseLabel: string;
  progressPct: number;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  error: string | null;
  analysisPath: string;
  logTail: string;
  hasRun?: boolean;
  sessionArtifactsVisible?: boolean;
}

const WATCHED_ARTIFACTS = [
  'report.json',
  'traffic-summary.json',
  'user-servers-session.json',
  'visuals-data.json',
  'figures/manifest.json',
  'latest.json',
  'analysis.txt',
];

interface TenantWatcherState {
  lastBroadcastPhase: string;
  lastBroadcastProgressKey: string;
  lastBroadcastState: string;
  artifactMtime: Map<string, number>;
}

const watchedTenants = new Set<string>();
const watcherState = new Map<string, TenantWatcherState>();
let jobWatchTimer: ReturnType<typeof setInterval> | null = null;

function swarmDir(tenantId: string): string {
  return getEffectiveSwarmDir(tenantId);
}

function jobPath(tenantId: string): string {
  return join(swarmDir(tenantId), 'job.json');
}

function analysisPath(tenantId: string): string {
  return join(swarmDir(tenantId), 'analysis.txt');
}

function loadJobFile(tenantId: string): Record<string, unknown> | null {
  const p = jobPath(tenantId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readLogTail(tenantId: string, maxLines = 50): string {
  const logPath = join(swarmDir(tenantId), 'job.log');
  if (!existsSync(logPath)) return '';
  const lines = readFileSync(logPath, 'utf-8').split('\n').filter(Boolean);
  return lines.slice(-maxLines).join('\n');
}

function getWatcherState(tenantId: string): TenantWatcherState {
  let s = watcherState.get(tenantId);
  if (!s) {
    s = { lastBroadcastPhase: '', lastBroadcastProgressKey: '', lastBroadcastState: '', artifactMtime: new Map() };
    watcherState.set(tenantId, s);
  }
  return s;
}

export function getSwarmJobStatus(tenantId: string = DEFAULT_TENANT_ID): SwarmJobStatus {
  const job = loadJobFile(tenantId);
  const analysis = analysisPath(tenantId);
  const hasRun = !!(job?.jobId || job?.startedAt);
  return {
    jobId: String(job?.jobId ?? ''),
    tenantId,
    state: (job?.state as SwarmJobStatus['state']) || 'idle',
    phase: String(job?.phase ?? ''),
    phaseLabel: String(job?.phaseLabel ?? ''),
    progressPct: Number(job?.progressPct ?? 0),
    startedAt: job?.startedAt ? String(job.startedAt) : null,
    finishedAt: job?.finishedAt ? String(job.finishedAt) : null,
    exitCode: job?.exitCode != null ? Number(job.exitCode) : null,
    error: job?.error ? String(job.error) : null,
    analysisPath: analysis,
    logTail: readLogTail(tenantId),
    hasRun,
    sessionArtifactsVisible: isSwarmSessionActiveForTenant(tenantId),
  };
}

export function isSwarmJobRunning(tenantId: string = DEFAULT_TENANT_ID): boolean {
  const job = loadJobFile(tenantId);
  return job?.state === 'running';
}

function checkIncrementalArtifacts(tenantId: string): void {
  const dir = swarmDir(tenantId);
  const state = getWatcherState(tenantId);
  for (const name of WATCHED_ARTIFACTS) {
    const p = name.includes('/') ? join(dir, name) : join(dir, name);
    if (!existsSync(p)) continue;
    try {
      const m = statSync(p).mtimeMs;
      const key = `${tenantId}:${name}`;
      if (state.artifactMtime.get(key) === m) continue;
      state.artifactMtime.set(key, m);
      broadcastDashboardEvent({
        type: 'analysis:artifact',
        tenantId,
        payload: { paths: [name], partial: true, tenantId },
        timestamp: Date.now(),
      });
    } catch {
      /* ignore */
    }
  }
}

function broadcastSwarmJob(tenantId: string, job: Record<string, unknown> | null): void {
  if (!job) return;
  const state = getWatcherState(tenantId);
  const jobState = String(job.state ?? 'idle');
  const phase = String(job.phase ?? '');
  const phaseLabel = String(job.phaseLabel ?? phase);
  const progressPct = Number(job.progressPct ?? 0);

  const progressKey = `${phase}:${phaseLabel}:${progressPct}`;

  if (jobState === 'running' && progressKey !== state.lastBroadcastProgressKey) {
    state.lastBroadcastProgressKey = progressKey;
    state.lastBroadcastPhase = phase;
    broadcastDashboardEvent({
      type: 'swarm:progress',
      tenantId,
      payload: { phase, phaseLabel, progressPct, jobId: job.jobId, tenantId },
      timestamp: Date.now(),
    });
    emitFlowStep({
      kind: 'swarm_phase',
      title: phaseLabel,
      summary: `Security analysis ${progressPct}%`,
      severity: 'info',
      metadata: { phase, progressPct, tenantId },
    });
  }

  if (jobState !== state.lastBroadcastState && (jobState === 'done' || jobState === 'failed')) {
    state.lastBroadcastState = jobState;
    watchedTenants.delete(tenantId);
    if (jobState === 'done') {
      broadcastDashboardEvent({
        type: 'swarm:done',
        tenantId,
        payload: { jobId: job.jobId, analysisPath: analysisPath(tenantId), tenantId },
        timestamp: Date.now(),
      });
      emitFlowStep({
        kind: 'swarm_done',
        title: 'Security analysis complete',
        summary: 'analysis.txt and gate artifacts ready',
        severity: 'success',
        metadata: { tenantId },
      });
      broadcastDashboardEvent({
        type: 'analysis:artifact',
        tenantId,
        payload: {
          paths: [
            'report.json',
            'traffic-summary.json',
            'user-servers-session.json',
            'visuals-data.json',
            'figures/manifest.json',
            'analysis.txt',
            'latest.json',
            'summary.md',
          ],
          tenantId,
        },
        timestamp: Date.now(),
      });
    } else {
      broadcastDashboardEvent({
        type: 'swarm:failed',
        tenantId,
        payload: { error: job.error, jobId: job.jobId, tenantId },
        timestamp: Date.now(),
      });
      emitFlowStep({
        kind: 'swarm_failed',
        title: 'Security analysis failed',
        summary: String(job.error || 'Unknown error'),
        severity: 'error',
        metadata: { tenantId },
      });
    }
    if (watchedTenants.size === 0) stopSwarmJobWatcher();
  }
}

function tickSwarmJobWatcher(tenantId: string): void {
  const job = loadJobFile(tenantId);
  if (!job || job.state !== 'running') {
    if (job) broadcastSwarmJob(tenantId, job);
    if (!job || job.state !== 'running') {
      watchedTenants.delete(tenantId);
      if (watchedTenants.size === 0) stopSwarmJobWatcher();
    }
    return;
  }
  broadcastSwarmJob(tenantId, job);
  checkIncrementalArtifacts(tenantId);
}

function tickAllWatchers(): void {
  for (const tenantId of [...watchedTenants]) {
    tickSwarmJobWatcher(tenantId);
  }
}

export function startSwarmJobWatcher(tenantId: string = DEFAULT_TENANT_ID): void {
  watchedTenants.add(tenantId);
  const state = getWatcherState(tenantId);
  state.lastBroadcastPhase = '';
  state.lastBroadcastProgressKey = '';
  state.lastBroadcastState = '';
  if (!jobWatchTimer) {
    tickAllWatchers();
    jobWatchTimer = setInterval(tickAllWatchers, 1000);
  }
}

export function stopSwarmJobWatcher(): void {
  if (jobWatchTimer) {
    clearInterval(jobWatchTimer);
    jobWatchTimer = null;
  }
}

if (isSwarmJobRunning(DEFAULT_TENANT_ID)) {
  startSwarmJobWatcher(DEFAULT_TENANT_ID);
}

export function startSwarmAnalysis(opts: {
  full?: boolean;
  tenantId?: string;
} = {}): {
  ok: boolean;
  jobId?: string;
  startedAt?: string;
  error?: string;
  status?: number;
  tenantId?: string;
} {
  const tenantId = opts.tenantId || DEFAULT_TENANT_ID;
  if (isSwarmJobRunning(tenantId)) {
    const job = loadJobFile(tenantId);
    return {
      ok: false,
      error: 'Analysis already running',
      status: 409,
      jobId: String(job?.jobId ?? ''),
      tenantId,
    };
  }
  if (!existsSync(RUN_SCRIPT)) {
    return { ok: false, error: 'run-analysis.mjs not found', status: 500, tenantId };
  }

  const swarmOut = ensureTenantSwarmDir(tenantId);
  const args = ['security-swarm/run-analysis.mjs', '--quiet'];
  if (opts.full) args.push('--nightly');

  const startedAt = new Date().toISOString();
  const jobId = randomUUID();
  mkdirSync(swarmOut, { recursive: true });
  writeFileSync(
    join(swarmOut, 'job.json'),
    JSON.stringify(
      {
        jobId,
        state: 'running',
        phase: 'preflight',
        phaseLabel: 'Preflight checks',
        progressPct: 0,
        startedAt,
        finishedAt: null,
        exitCode: null,
        error: null,
        analysisPath: join(swarmOut, 'analysis.txt'),
      },
      null,
      2,
    ),
  );

  const logPath = join(swarmOut, 'job.log');
  const child = spawn(process.execPath, args, {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: {
      ...process.env,
      MASTYF_AI_SWARM_DIR: swarmOut,
      MASTYF_AI_TENANT_ID: tenantId,
      // Required: gate-pro.mjs checks this; set in dashboard via CI token or legacy env var
      MASTYF_AI_CI_BYPASS_LICENSE: process.env['MASTYF_AI_CI_BYPASS_LICENSE'] || undefined,
      MASTYF_AI_CI_TOKEN: process.env['MASTYF_AI_CI_TOKEN'] || undefined,
      // Skip --skip-continuous always when launched from dashboard
      MASTYF_AI_SWARM_SKIP_CONTINUOUS: 'true',
    },
  });
  child.unref();

  // Watch for immediate exit — if the license gate or preflight fails
  // before run-analysis.mjs gets to write the job file, patch it ourselves
  child.once('exit', (code) => {
    if (code === 0) return; // normal exit — run-analysis.mjs will have written job.json
    const existingJob = loadJobFile(tenantId);
    // Only patch if the job file still shows the state we wrote (not updated by the child)
    if (existingJob?.jobId === jobId && existingJob?.state === 'running') {
      writeFileSync(
        join(swarmOut, 'job.json'),
        JSON.stringify(
          {
            ...existingJob,
            state: 'failed',
            finishedAt: new Date().toISOString(),
            exitCode: code,
            error: `Analysis process exited ${code} before starting — check gate-pro.mjs / pnpm build`,
          },
          null,
          2,
        ),
      );
    }
  });

  startSwarmJobWatcher(tenantId);
  setTimeout(() => tickSwarmJobWatcher(tenantId), 300);
  return {
    ok: true,
    jobId,
    startedAt,
    tenantId,
  };
}

export function readAnalysisReport(tenantId: string = DEFAULT_TENANT_ID): {
  ok: boolean;
  text?: string;
  error?: string;
} {
  const path = analysisPath(tenantId);
  if (!existsSync(path)) {
    return { ok: false, error: 'analysis.txt not ready — run analysis first' };
  }
  if (!isSwarmArtifactVisibleForSession(path, tenantId)) {
    return { ok: false, error: 'No analysis from this dashboard session — run Security Swarm first' };
  }
  return { ok: true, text: readFileSync(path, 'utf-8') };
}

export {
  REPO_ROOT,
  SWARM_DIR,
  readSwarmLatest,
  readSwarmSummaryMd,
  listSwarmFigures,
  readSwarmFigure,
  readPlainEnglishReport,
  readTrafficSummary,
  readUserServersSession,
} from './swarm-artifacts.js';
