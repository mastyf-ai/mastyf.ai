/**
 * Read security-swarm report artifacts for dashboard API (per-tenant dirs).
 */
import { existsSync, readFileSync, readdirSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TENANT_ID, validateTenantId, } from '../tenant/resolve-tenant.js';
import { getEffectiveSwarmDir, LEGACY_SWARM_DIR, resolveTenantSwarmDir, } from '../tenant/swarm-tenant-paths.js';
import { isLegacyArtifactsAllowed, isSwarmArtifactVisibleForSession, } from './swarm-session.js';
const __dir = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(__dir, '..', '..');
/** Legacy global swarm dir (default tenant fallback). */
export const SWARM_DIR = LEGACY_SWARM_DIR;
export const LIVE_SESSION_PATH = join(REPO_ROOT, 'scenarios', 'real-life', 'output', 'live-filesystem-session.json');
function readDir(tenantId) {
    return getEffectiveSwarmDir(tenantId || DEFAULT_TENANT_ID);
}
function resolvedTenantId(tenantId) {
    return validateTenantId(tenantId?.trim() || DEFAULT_TENANT_ID);
}
/** Tenant dir first; legacy global dir only when explicitly opted in. */
function swarmArtifactCandidates(name, tenantId) {
    const tid = resolvedTenantId(tenantId);
    const tenantPath = join(resolveTenantSwarmDir(tid), name);
    const out = [tenantPath];
    if (tid === DEFAULT_TENANT_ID && isLegacyArtifactsAllowed()) {
        const legacyPath = join(LEGACY_SWARM_DIR, name);
        if (legacyPath !== tenantPath)
            out.push(legacyPath);
    }
    return out;
}
function findSwarmArtifactPath(name, tenantId) {
    for (const p of swarmArtifactCandidates(name, tenantId)) {
        if (!existsSync(p))
            continue;
        if (!isSwarmArtifactVisibleForSession(p, tenantId))
            continue;
        return p;
    }
    return null;
}
export function readSwarmJsonFile(name, tenantId) {
    const p = findSwarmArtifactPath(name, tenantId);
    if (!p)
        return null;
    try {
        return JSON.parse(readFileSync(p, 'utf-8'));
    }
    catch {
        return null;
    }
}
function writeDir(tenantId) {
    return resolveTenantSwarmDir(tenantId);
}
function figuresDir(tenantId) {
    return join(readDir(tenantId), 'figures');
}
function swarmReportUrlPrefix(tenantId) {
    const tid = validateTenantId(tenantId);
    const dir = readDir(tid);
    if (dir === LEGACY_SWARM_DIR)
        return '/reports/security-swarm';
    return `/reports/tenants/${tid}/security-swarm`;
}
export function readLiveFilesystemSession(tenantId) {
    const dir = readDir(tenantId);
    const jobPath = join(dir, 'job.json');
    let job = null;
    if (existsSync(jobPath)) {
        try {
            job = JSON.parse(readFileSync(jobPath, 'utf-8'));
        }
        catch {
            job = null;
        }
    }
    if (!job || job.state !== 'done')
        return null;
    const startedAt = job.startedAt ? Date.parse(String(job.startedAt)) : 0;
    const candidates = [
        join(dir, 'live-filesystem-session.json'),
        LIVE_SESSION_PATH,
    ];
    for (const p of candidates) {
        if (!existsSync(p))
            continue;
        try {
            const mtime = statSync(p).mtimeMs;
            if (startedAt > 0 && mtime < startedAt - 60_000)
                continue;
            return JSON.parse(readFileSync(p, 'utf-8'));
        }
        catch {
            /* try next */
        }
    }
    return null;
}
export function readSwarmLatest(tenantId) {
    const p = join(readDir(tenantId), 'latest.json');
    if (!existsSync(p) || !isSwarmArtifactVisibleForSession(p, tenantId))
        return null;
    try {
        return JSON.parse(readFileSync(p, 'utf-8'));
    }
    catch {
        return null;
    }
}
export function readSwarmSummaryMd(tenantId) {
    const p = join(readDir(tenantId), 'summary.md');
    if (!existsSync(p) || !isSwarmArtifactVisibleForSession(p, tenantId))
        return null;
    return readFileSync(p, 'utf-8');
}
export function listSwarmFigures(tenantId) {
    const figDir = figuresDir(tenantId);
    if (!existsSync(figDir))
        return [];
    return readdirSync(figDir)
        .filter((f) => f.endsWith('.png'))
        .sort();
}
export function readFiguresManifest(tenantId) {
    const tid = tenantId || DEFAULT_TENANT_ID;
    const manifestPath = join(figuresDir(tenantId), 'manifest.json');
    const urlPrefix = `${swarmReportUrlPrefix(tid)}/figures`;
    const manifestVisible = existsSync(manifestPath) && isSwarmArtifactVisibleForSession(manifestPath, tenantId);
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
        const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
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
    }
    catch {
        return { figures: [] };
    }
}
export function readVisualsData(tenantId) {
    const p = join(readDir(tenantId), 'visuals-data.json');
    if (!existsSync(p) || !isSwarmArtifactVisibleForSession(p, tenantId))
        return null;
    try {
        return JSON.parse(readFileSync(p, 'utf-8'));
    }
    catch {
        return null;
    }
}
export function visualsDataPath(tenantId) {
    return join(writeDir(tenantId), 'visuals-data.json');
}
export function readSwarmFigure(name, tenantId) {
    if (!name || name.includes('..') || !name.endsWith('.png'))
        return null;
    const p = join(figuresDir(tenantId), name);
    if (!existsSync(p) || !isSwarmArtifactVisibleForSession(p, tenantId))
        return null;
    return readFileSync(p);
}
export function readUserServersSession(tenantId) {
    const p = join(readDir(tenantId), 'user-servers-session.json');
    if (!existsSync(p) || !isSwarmArtifactVisibleForSession(p, tenantId))
        return null;
    try {
        return JSON.parse(readFileSync(p, 'utf-8'));
    }
    catch {
        return null;
    }
}
export function readTrafficSummary(tenantId) {
    const p = join(readDir(tenantId), 'traffic-summary.json');
    if (!existsSync(p) || !isSwarmArtifactVisibleForSession(p, tenantId))
        return null;
    try {
        return JSON.parse(readFileSync(p, 'utf-8'));
    }
    catch {
        return null;
    }
}
export function readPlainEnglishReport(tenantId) {
    const p = join(readDir(tenantId), 'report.json');
    if (!existsSync(p) || !isSwarmArtifactVisibleForSession(p, tenantId))
        return null;
    try {
        return JSON.parse(readFileSync(p, 'utf-8'));
    }
    catch {
        return null;
    }
}
/** Build report.json from latest.json / analysis artifacts when missing (e.g. pre-MVP runs). */
export function ensurePlainEnglishReport(tenantId) {
    const existing = readPlainEnglishReport(tenantId);
    if (existing)
        return existing;
    const dir = readDir(tenantId);
    const hasSource = existsSync(join(dir, 'latest.json')) || existsSync(join(dir, 'analysis.txt'));
    if (!hasSource)
        return null;
    const script = join(REPO_ROOT, 'security-swarm', 'agents', 'plain-english-report.mjs');
    if (!existsSync(script))
        return null;
    const tid = tenantId || DEFAULT_TENANT_ID;
    spawnSync(process.execPath, [script], {
        cwd: REPO_ROOT,
        stdio: 'pipe',
        env: {
            ...process.env,
            MASTYF_AI_SWARM_DIR: writeDir(tid),
            MASTYF_AI_TENANT_ID: tid,
        },
    });
    return readPlainEnglishReport(tenantId);
}
export function readSwarmTextArtifact(name, tenantId) {
    const allowed = new Set(['summary.md', 'swarm-report.txt', 'analysis.txt', 'job.log']);
    if (!allowed.has(name))
        return null;
    const p = join(readDir(tenantId), name);
    if (!existsSync(p) || !isSwarmArtifactVisibleForSession(p, tenantId))
        return null;
    return readFileSync(p, 'utf-8');
}
export function ensureTenantSwarmDir(tenantId) {
    const dir = writeDir(tenantId);
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, 'figures'), { recursive: true });
    return dir;
}
export function readThreatLabCandidates(tenantId) {
    const data = readSwarmJsonFile('threat-lab-candidates.json', tenantId);
    if (!data)
        return null;
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
export function readThreatLabCandidateById(tenantId, id) {
    const manifest = readThreatLabCandidates(tenantId);
    if (!manifest)
        return null;
    return manifest.candidates.find((c) => c.id === id) ?? null;
}
/** Read Threat Lab candidates without dashboard session gating (incident investigator). */
export function readThreatLabCandidatesUngated(tenantId) {
    const tid = validateTenantId(tenantId?.trim() || DEFAULT_TENANT_ID);
    const dirs = [resolveTenantSwarmDir(tid)];
    if (tid === DEFAULT_TENANT_ID) {
        dirs.push(join(REPO_ROOT, 'reports/security-swarm'), LEGACY_SWARM_DIR);
    }
    const byId = new Map();
    for (const dir of dirs) {
        const p = join(dir, 'threat-lab-candidates.json');
        if (!existsSync(p))
            continue;
        try {
            const data = JSON.parse(readFileSync(p, 'utf-8'));
            if (!Array.isArray(data.candidates))
                continue;
            for (const c of data.candidates) {
                if (c?.id && !byId.has(c.id))
                    byId.set(c.id, c);
            }
        }
        catch {
            /* try next dir */
        }
    }
    return [...byId.values()];
}
export function findThreatLabCandidateUngated(tenantId, triggerId) {
    const needle = triggerId.trim();
    if (!needle)
        return null;
    return (readThreatLabCandidatesUngated(tenantId).find((c) => c.id === needle
        || c.fingerprint === needle
        || c.provenance?.inputFingerprint === needle) ?? null);
}
export function readAutoCorpusManifestUngated(tenantId) {
    const tid = validateTenantId(tenantId?.trim() || DEFAULT_TENANT_ID);
    const dirs = [resolveTenantSwarmDir(tid)];
    if (tid === DEFAULT_TENANT_ID) {
        const legacy = join(REPO_ROOT, 'reports', 'security-swarm');
        if (!dirs.includes(legacy))
            dirs.push(legacy);
        if (isLegacyArtifactsAllowed() && !dirs.includes(LEGACY_SWARM_DIR)) {
            dirs.push(LEGACY_SWARM_DIR);
        }
    }
    const byAdvId = new Map();
    for (const dir of dirs) {
        const p = join(dir, 'auto-corpus-manifest.json');
        if (!existsSync(p))
            continue;
        try {
            const data = JSON.parse(readFileSync(p, 'utf-8'));
            if (!Array.isArray(data.entries))
                continue;
            for (const entry of data.entries) {
                if (entry?.advId && !byAdvId.has(entry.advId))
                    byAdvId.set(entry.advId, entry);
            }
        }
        catch {
            /* try next dir */
        }
    }
    return [...byAdvId.values()].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}
export function readAutoCorpusManifest(tenantId) {
    const gated = readSwarmJsonFile('auto-corpus-manifest.json', tenantId);
    if (gated?.entries?.length)
        return gated;
    const entries = readAutoCorpusManifestUngated(tenantId);
    if (entries.length === 0)
        return null;
    return {
        timestamp: entries[0]?.timestamp || new Date().toISOString(),
        count: entries.length,
        entries,
    };
}
export function markThreatLabCandidate(tenantId, id, status) {
    const p = findSwarmArtifactPath('threat-lab-candidates.json', tenantId);
    if (!p)
        return false;
    try {
        const data = JSON.parse(readFileSync(p, 'utf-8'));
        let found = false;
        for (const c of data.candidates || []) {
            if (c.id === id) {
                c.reviewStatus = status;
                found = true;
            }
        }
        if (!found)
            return false;
        writeFileSync(p, JSON.stringify(data, null, 2));
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Upsert a Threat Lab candidate (used by Vuln Discovery propose-block).
 * Creates the manifest file under the tenant swarm dir when missing.
 */
export function upsertThreatLabCandidate(tenantId, candidate) {
    const tid = resolvedTenantId(tenantId);
    const dir = resolveTenantSwarmDir(tid);
    mkdirSync(dir, { recursive: true });
    const p = join(dir, 'threat-lab-candidates.json');
    let data = { candidates: [], mode: 'vuln-discovery', timestamp: new Date().toISOString() };
    try {
        const parsed = JSON.parse(readFileSync(p, 'utf-8'));
        data = {
            ...parsed,
            candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
        };
    }
    catch {
        /* fresh file */
    }
    const idx = data.candidates.findIndex((c) => c.id === candidate.id
        || (candidate.fingerprint && c.fingerprint === candidate.fingerprint)
        || (candidate.provenance?.inputFingerprint
            && c.provenance?.inputFingerprint === candidate.provenance.inputFingerprint));
    if (idx >= 0) {
        data.candidates[idx] = {
            ...data.candidates[idx],
            ...candidate,
            reviewStatus: data.candidates[idx].reviewStatus || candidate.reviewStatus || 'pending',
        };
    }
    else {
        data.candidates.push({ ...candidate, reviewStatus: candidate.reviewStatus || 'pending' });
    }
    data.count = data.candidates.length;
    data.timestamp = new Date().toISOString();
    writeFileSync(p, JSON.stringify(data, null, 2));
    return idx >= 0 ? data.candidates[idx] : candidate;
}
//# sourceMappingURL=swarm-artifacts.js.map