/**
 * Mastyf AI server registry: mastyf-ai-configs + history.db metrics.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createDatabase } from '../database/create-database.js';
import { resolveMastyfAiDbPath } from './mastyf-ai-db-path.js';
import { getAllActiveServerNames, loadAllCallRecords, summarizeRecords, } from './db-aggregate.js';
import { ConfigParser } from '../config-parser.js';
import { readOnboardArtifact } from '../cli/onboard.js';
import { getEffectiveSwarmDir } from '../tenant/swarm-tenant-paths.js';
import { DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';
function listMastyfAiConfigPaths(configsDir) {
    if (!existsSync(configsDir))
        return [];
    return readdirSync(configsDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => join(configsDir, f));
}
function topTools(records, limit = 5) {
    const counts = new Map();
    for (const r of records) {
        const t = r.toolName || '(unknown)';
        counts.set(t, (counts.get(t) || 0) + 1);
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([tool, count]) => ({ tool, count }));
}
export async function getServerRegistry(projectRoot) {
    const { resolveWorkspaceRoot, configsDir } = await import('../fleet/unified-server-registry.js');
    const workspaceRoot = projectRoot ?? resolveWorkspaceRoot();
    const configsDirPath = configsDir(workspaceRoot);
    const paths = listMastyfAiConfigPaths(configsDirPath);
    const dbPath = resolveMastyfAiDbPath();
    const db = await createDatabase(dbPath);
    await db.initialize();
    const activeNames = await getAllActiveServerNames(db);
    const allRecords = await loadAllCallRecords(db, activeNames);
    await db.close();
    const entries = [];
    for (const configPath of paths) {
        try {
            const servers = ConfigParser.parse(configPath);
            for (const s of servers) {
                const recs = allRecords.filter((r) => r.serverName === s.name);
                const sum = summarizeRecords(recs);
                let lastMs = 0;
                for (const r of recs) {
                    const t = new Date(r.timestamp || 0).getTime();
                    if (!Number.isNaN(t) && t > lastMs)
                        lastMs = t;
                }
                entries.push({
                    name: s.name,
                    configPath,
                    transport: s.transport || (s.url ? 'sse' : 'stdio'),
                    command: s.command,
                    wrapped: true,
                    metrics: recs.length
                        ? {
                            totalCalls: sum.total,
                            blocked: sum.blocked,
                            passed: sum.passed,
                            lastSeen: lastMs ? new Date(lastMs).toISOString() : null,
                            topTools: topTools(recs),
                        }
                        : undefined,
                });
            }
        }
        catch {
            /* skip malformed config */
        }
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
}
export async function getOnboardingStatus(projectRoot) {
    const onboard = readOnboardArtifact();
    const { resolveWorkspaceRoot, configsDir } = await import('../fleet/unified-server-registry.js');
    const workspaceRoot = projectRoot ?? resolveWorkspaceRoot();
    const configsDirPath = onboard?.configsDir ?? configsDir(workspaceRoot);
    const configCount = listMastyfAiConfigPaths(configsDirPath).length;
    const dbPath = resolveMastyfAiDbPath();
    let totalCalls = 0;
    let hasTraffic = false;
    try {
        const db = await createDatabase(dbPath);
        await db.initialize();
        const names = await getAllActiveServerNames(db);
        const recs = await loadAllCallRecords(db, names);
        totalCalls = recs.length;
        hasTraffic = totalCalls > 0;
        await db.close();
    }
    catch {
        /* db may not exist yet */
    }
    let lastAnalysisAt = null;
    let lastAnalysisState = null;
    const jobPath = join(getEffectiveSwarmDir(DEFAULT_TENANT_ID), 'job.json');
    if (existsSync(jobPath)) {
        try {
            const job = JSON.parse(readFileSync(jobPath, 'utf-8'));
            lastAnalysisAt = job.finishedAt ? String(job.finishedAt) : job.startedAt ? String(job.startedAt) : null;
            lastAnalysisState = job.state ? String(job.state) : null;
        }
        catch {
            /* ignore */
        }
    }
    return {
        onboarded: !!onboard,
        onboardedAt: onboard?.onboardedAt ?? null,
        client: onboard?.client ?? null,
        wrapApplied: onboard?.applied ?? false,
        configsDir: existsSync(configsDirPath) ? configsDirPath : null,
        configCount,
        hasTraffic,
        totalCalls,
        lastAnalysisAt,
        lastAnalysisState,
        dbPath,
        commands: {
            onboard: 'pnpm onboard -- --client cursor --apply',
            dashboardProxy: 'mastyf-ai start',
            runAnalysis: 'pnpm security-swarm:analyze',
        },
    };
}
//# sourceMappingURL=server-registry.js.map