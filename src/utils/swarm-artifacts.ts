/**
 * Read security-swarm report artifacts for dashboard API (per-tenant dirs).
 */
import { existsSync, readFileSync, readdirSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_TENANT_ID,
  validateTenantId,
} from '../tenant/resolve-tenant.js';
import {
  getEffectiveSwarmDir,
  LEGACY_SWARM_DIR,
  resolveTenantSwarmDir,
} from '../tenant/swarm-tenant-paths.js';
import {
  isLegacyArtifactsAllowed,
  isSwarmArtifactVisibleForSession,
} from './swarm-session.js';

const __dir = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(__dir, '..', '..');

/** Legacy global swarm dir (default tenant fallback). */
export const SWARM_DIR = LEGACY_SWARM_DIR;

export const LIVE_SESSION_PATH = join(
  REPO_ROOT,
  'scenarios',
  'real-life',
  'output',
  'live-filesystem-session.json',
);

function readDir(tenantId?: string): string {
  return getEffectiveSwarmDir(tenantId || DEFAULT_TENANT_ID);
}

function resolvedTenantId(tenantId?: string): string {
  return validateTenantId(tenantId?.trim() || DEFAULT_TENANT_ID);
}

/** Tenant dir first; legacy global dir only when explicitly opted in. */
function swarmArtifactCandidates(name: string, tenantId?: string): string[] {
  const tid = resolvedTenantId(tenantId);
  const tenantPath = join(resolveTenantSwarmDir(tid), name);
  const out = [tenantPath];
  if (tid === DEFAULT_TENANT_ID && isLegacyArtifactsAllowed()) {
    const legacyPath = join(LEGACY_SWARM_DIR, name);
    if (legacyPath !== tenantPath) out.push(legacyPath);
  }
  return out;
}

function findSwarmArtifactPath(name: string, tenantId?: string): string | null {
  for (const p of swarmArtifactCandidates(name, tenantId)) {
    if (!existsSync(p)) continue;
    if (!isSwarmArtifactVisibleForSession(p, tenantId)) continue;
    return p;
  }
  return null;
}

export function readSwarmJsonFile<T>(name: string, tenantId?: string): T | null {
  const p = findSwarmArtifactPath(name, tenantId);
  if (!p) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function writeDir(tenantId: string): string {
  return resolveTenantSwarmDir(tenantId);
}

function figuresDir(tenantId?: string): string {
  return join(readDir(tenantId), 'figures');
}

function swarmReportUrlPrefix(tenantId: string): string {
  const tid = validateTenantId(tenantId);
  const dir = readDir(tid);
  if (dir === LEGACY_SWARM_DIR) return '/reports/security-swarm';
  return `/reports/tenants/${tid}/security-swarm`;
}

export function readLiveFilesystemSession(tenantId?: string): Record<string, unknown> | null {
  const dir = readDir(tenantId);
  const jobPath = join(dir, 'job.json');
  let job: Record<string, unknown> | null = null;
  if (existsSync(jobPath)) {
    try {
      job = JSON.parse(readFileSync(jobPath, 'utf-8')) as Record<string, unknown>;
    } catch {
      job = null;
    }
  }
  if (!job || job.state !== 'done') return null;

  const startedAt = job.startedAt ? Date.parse(String(job.startedAt)) : 0;
  const candidates = [
    join(dir, 'live-filesystem-session.json'),
    LIVE_SESSION_PATH,
  ];

  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const mtime = statSync(p).mtimeMs;
      if (startedAt > 0 && mtime < startedAt - 60_000) continue;
      return JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>;
    } catch {
      /* try next */
    }
  }
  return null;
}

export function readSwarmLatest(tenantId?: string): Record<string, unknown> | null {
  const p = join(readDir(tenantId), 'latest.json');
  if (!existsSync(p) || !isSwarmArtifactVisibleForSession(p, tenantId)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function readSwarmSummaryMd(tenantId?: string): string | null {
  const p = join(readDir(tenantId), 'summary.md');
  if (!existsSync(p) || !isSwarmArtifactVisibleForSession(p, tenantId)) return null;
  return readFileSync(p, 'utf-8');
}

export function listSwarmFigures(tenantId?: string): string[] {
  const figDir = figuresDir(tenantId);
  if (!existsSync(figDir)) return [];
  return readdirSync(figDir)
    .filter((f) => f.endsWith('.png'))
    .sort();
}

export interface SwarmFigureEntry {
  name: string;
  title: string;
  category: string;
  url: string;
  generatedAt?: string;
  dataSource?: string;
}

export function readFiguresManifest(tenantId?: string): {
  generatedAt?: string;
  figures: SwarmFigureEntry[];
} {
  const tid = tenantId || DEFAULT_TENANT_ID;
  const manifestPath = join(figuresDir(tenantId), 'manifest.json');
  const urlPrefix = `${swarmReportUrlPrefix(tid)}/figures`;
  const manifestVisible =
    existsSync(manifestPath) && isSwarmArtifactVisibleForSession(manifestPath, tenantId);
  if (!manifestVisible) {
    return {
      figures: listSwarmFigures(tenantId)
        .filter((name) => {
          const p = join(figuresDir(tenantId), name);
          return isSwarmArtifactVisibleForSession(p, tenantId);
        })
        .map((name) => ({
          name,
          title: name.replace('.png', '').replace(/-/g, ' '),
          category: 'other',
          url: `${urlPrefix}/${name}`,
        })),
    };
  }
  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
      generatedAt?: string;
      figures?: SwarmFigureEntry[];
    };
    const figures = (raw.figures ?? [])
      .filter((f) => {
        const p = join(figuresDir(tenantId), f.name);
        return isSwarmArtifactVisibleForSession(p, tenantId);
      })
      .map((f) => ({
      ...f,
      url: f.url?.startsWith('/') ? f.url : `${urlPrefix}/${f.name}`,
    }));
    return { generatedAt: raw.generatedAt, figures };
  } catch {
    return { figures: [] };
  }
}

export function readVisualsData(tenantId?: string): Record<string, unknown> | null {
  const p = join(readDir(tenantId), 'visuals-data.json');
  if (!existsSync(p) || !isSwarmArtifactVisibleForSession(p, tenantId)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function visualsDataPath(tenantId: string): string {
  return join(writeDir(tenantId), 'visuals-data.json');
}

export function readSwarmFigure(name: string, tenantId?: string): Buffer | null {
  if (!name || name.includes('..') || !name.endsWith('.png')) return null;
  const p = join(figuresDir(tenantId), name);
  if (!existsSync(p) || !isSwarmArtifactVisibleForSession(p, tenantId)) return null;
  return readFileSync(p);
}

export function readUserServersSession(tenantId?: string): Record<string, unknown> | null {
  const p = join(readDir(tenantId), 'user-servers-session.json');
  if (!existsSync(p) || !isSwarmArtifactVisibleForSession(p, tenantId)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function readTrafficSummary(tenantId?: string): Record<string, unknown> | null {
  const p = join(readDir(tenantId), 'traffic-summary.json');
  if (!existsSync(p) || !isSwarmArtifactVisibleForSession(p, tenantId)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function readPlainEnglishReport(tenantId?: string): Record<string, unknown> | null {
  const p = join(readDir(tenantId), 'report.json');
  if (!existsSync(p) || !isSwarmArtifactVisibleForSession(p, tenantId)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Build report.json from latest.json / analysis artifacts when missing (e.g. pre-MVP runs). */
export function ensurePlainEnglishReport(tenantId?: string): Record<string, unknown> | null {
  const existing = readPlainEnglishReport(tenantId);
  if (existing) return existing;

  const dir = readDir(tenantId);
  const hasSource =
    existsSync(join(dir, 'latest.json')) || existsSync(join(dir, 'analysis.txt'));
  if (!hasSource) return null;

  const script = join(REPO_ROOT, 'security-swarm', 'agents', 'plain-english-report.mjs');
  if (!existsSync(script)) return null;

  const tid = tenantId || DEFAULT_TENANT_ID;
  spawnSync(process.execPath, [script], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
    env: {
      ...process.env,
      GUARDIAN_SWARM_DIR: writeDir(tid),
      GUARDIAN_TENANT_ID: tid,
    },
  });
  return readPlainEnglishReport(tenantId);
}

export function readSwarmTextArtifact(name: string, tenantId?: string): string | null {
  const allowed = new Set(['summary.md', 'swarm-report.txt', 'analysis.txt', 'job.log']);
  if (!allowed.has(name)) return null;
  const p = join(readDir(tenantId), name);
  if (!existsSync(p) || !isSwarmArtifactVisibleForSession(p, tenantId)) return null;
  return readFileSync(p, 'utf-8');
}

export function ensureTenantSwarmDir(tenantId: string): string {
  const dir = writeDir(tenantId);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'figures'), { recursive: true });
  return dir;
}

export type ThreatLabCandidateRecord = {
  id: string;
  fingerprint: string;
  attackClass: string;
  hypothesis: string;
  confidence: number;
  path?: string;
  branch?: string;
  reviewStatus?: 'pending' | 'accepted' | 'rejected';
  policyRule?: Record<string, unknown>;
  corpusCandidate?: Record<string, unknown>;
  provenance?: {
    source?: string;
    llmUsed?: boolean;
    inputFingerprint?: string;
  };
  validation?: {
    ok?: boolean;
    errors?: string[];
    replayBlocked?: boolean;
  };
  advWriteSkipped?: string;
};

export function readThreatLabCandidates(tenantId?: string): {
  timestamp?: string;
  count?: number;
  mode?: string;
  llmModel?: string;
  llmUsed?: boolean;
  skipped?: string;
  runNote?: string;
  candidates: ThreatLabCandidateRecord[];
} | null {
  const data = readSwarmJsonFile<{
    timestamp?: string;
    count?: number;
    mode?: string;
    llmModel?: string;
    llmUsed?: boolean;
    skipped?: string;
    runNote?: string;
    candidates?: ThreatLabCandidateRecord[];
  }>('threat-lab-candidates.json', tenantId);
  if (!data) return null;
  return {
    timestamp: data.timestamp,
    count: data.count,
    mode: data.mode,
    llmModel: data.llmModel,
    llmUsed: data.llmUsed,
    skipped: data.skipped,
    runNote: data.runNote,
    candidates: data.candidates || [],
  };
}

export function readThreatLabCandidateById(
  tenantId: string | undefined,
  id: string,
): ThreatLabCandidateRecord | null {
  const manifest = readThreatLabCandidates(tenantId);
  if (!manifest) return null;
  return manifest.candidates.find((c) => c.id === id) ?? null;
}

/** Read Threat Lab candidates without dashboard session gating (incident investigator). */
export function readThreatLabCandidatesUngated(tenantId?: string): ThreatLabCandidateRecord[] {
  const tid = validateTenantId(tenantId?.trim() || DEFAULT_TENANT_ID);
  const dirs = [resolveTenantSwarmDir(tid)];
  if (tid === DEFAULT_TENANT_ID) {
    dirs.push(join(REPO_ROOT, 'reports/security-swarm'), LEGACY_SWARM_DIR);
  }
  const byId = new Map<string, ThreatLabCandidateRecord>();
  for (const dir of dirs) {
    const p = join(dir, 'threat-lab-candidates.json');
    if (!existsSync(p)) continue;
    try {
      const data = JSON.parse(readFileSync(p, 'utf-8')) as { candidates?: ThreatLabCandidateRecord[] };
      if (!Array.isArray(data.candidates)) continue;
      for (const c of data.candidates) {
        if (c?.id && !byId.has(c.id)) byId.set(c.id, c);
      }
    } catch {
      /* try next dir */
    }
  }
  return [...byId.values()];
}

export function findThreatLabCandidateUngated(
  tenantId: string | undefined,
  triggerId: string,
): ThreatLabCandidateRecord | null {
  const needle = triggerId.trim();
  if (!needle) return null;
  return (
    readThreatLabCandidatesUngated(tenantId).find(
      (c) =>
        c.id === needle
        || c.fingerprint === needle
        || c.provenance?.inputFingerprint === needle,
    ) ?? null
  );
}

export type AutoCorpusManifestEntry = {
  advId: string;
  relPath: string;
  fingerprint: string;
  source: string;
  attackClass: string;
  hypothesis: string;
  confidence: number;
  timestamp: string;
  toolName: string;
  category: string;
};

export function readAutoCorpusManifest(tenantId?: string): {
  timestamp: string;
  count: number;
  entries: AutoCorpusManifestEntry[];
} | null {
  return readSwarmJsonFile<{
    timestamp: string;
    count: number;
    entries: AutoCorpusManifestEntry[];
  }>('auto-corpus-manifest.json', tenantId);
}

export function markThreatLabCandidate(
  tenantId: string | undefined,
  id: string,
  status: 'accepted' | 'rejected',
): boolean {
  const p = findSwarmArtifactPath('threat-lab-candidates.json', tenantId);
  if (!p) return false;
  try {
    const data = JSON.parse(readFileSync(p, 'utf-8')) as {
      candidates?: ThreatLabCandidateRecord[];
    };
    let found = false;
    for (const c of data.candidates || []) {
      if (c.id === id) {
        c.reviewStatus = status;
        found = true;
      }
    }
    if (!found) return false;
    writeFileSync(p, JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
}
