/**
 * Shared threat-discovery job.json / job.log helpers for dashboard runner and CLI scripts.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';
import { getEffectiveSwarmDir } from '../tenant/swarm-tenant-paths.js';

export type ThreatDiscoveryJobKind = 'threat-lab' | 'auto-research';

const JOB_FILES: Record<ThreatDiscoveryJobKind, string> = {
  'threat-lab': 'threat-lab-job.json',
  'auto-research': 'auto-research-job.json',
};

const LOG_FILES: Record<ThreatDiscoveryJobKind, string> = {
  'threat-lab': 'threat-lab-job.log',
  'auto-research': 'auto-research-job.log',
};

function resolveTenantId(tenantId?: string): string {
  return tenantId?.trim() || process.env.MASTYF_AI_TENANT_ID?.trim() || DEFAULT_TENANT_ID;
}

function swarmDir(tenantId?: string): string {
  const tid = resolveTenantId(tenantId);
  const envOverride = process.env.MASTYF_AI_SWARM_DIR?.trim();
  const envTenant = process.env.MASTYF_AI_TENANT_ID?.trim() || DEFAULT_TENANT_ID;
  // Dashboard sets MASTYF_AI_SWARM_DIR for the active tenant only — do not leak to other tenants in tests.
  if (envOverride && tid === envTenant) return envOverride;
  return getEffectiveSwarmDir(tid);
}

export function threatDiscoveryJobPath(kind: ThreatDiscoveryJobKind, tenantId?: string): string {
  return join(swarmDir(tenantId), JOB_FILES[kind]);
}

export function threatDiscoveryLogPath(kind: ThreatDiscoveryJobKind, tenantId?: string): string {
  return join(swarmDir(tenantId), LOG_FILES[kind]);
}

export function loadThreatDiscoveryJob(
  kind: ThreatDiscoveryJobKind,
  tenantId?: string,
): Record<string, unknown> | null {
  const p = threatDiscoveryJobPath(kind, tenantId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function patchThreatDiscoveryJob(
  kind: ThreatDiscoveryJobKind,
  patch: Record<string, unknown>,
  tenantId?: string,
): void {
  const tid = resolveTenantId(tenantId);
  mkdirSync(swarmDir(tid), { recursive: true });
  const existing = loadThreatDiscoveryJob(kind, tid) || {};
  writeFileSync(
    threatDiscoveryJobPath(kind, tid),
    JSON.stringify({ ...existing, ...patch, kind, tenantId: tid }, null, 2),
  );
}

export function appendThreatDiscoveryLog(
  kind: ThreatDiscoveryJobKind,
  message: string,
  tenantId?: string,
): void {
  const tid = resolveTenantId(tenantId);
  mkdirSync(swarmDir(tid), { recursive: true });
  appendFileSync(threatDiscoveryLogPath(kind, tid), `${message}\n`);
  console.log(message);
}

export function finishThreatDiscoveryJob(
  kind: ThreatDiscoveryJobKind,
  outcome: { ok: boolean; error?: string; extra?: Record<string, unknown> },
  tenantId?: string,
): void {
  patchThreatDiscoveryJob(
    kind,
    {
      state: outcome.ok ? 'done' : 'failed',
      phase: outcome.ok ? 'done' : 'failed',
      phaseLabel: outcome.ok ? 'Complete' : 'Failed',
      progressPct: outcome.ok ? 100 : 0,
      finishedAt: new Date().toISOString(),
      exitCode: outcome.ok ? 0 : 1,
      error: outcome.error || null,
      pid: null,
      ...outcome.extra,
    },
    tenantId,
  );
}

export function readThreatDiscoveryLogTail(
  kind: ThreatDiscoveryJobKind,
  tenantId?: string,
  maxLines = 40,
): string {
  const p = threatDiscoveryLogPath(kind, tenantId);
  if (!existsSync(p)) return '';
  return readFileSync(p, 'utf-8').split('\n').filter(Boolean).slice(-maxLines).join('\n');
}
