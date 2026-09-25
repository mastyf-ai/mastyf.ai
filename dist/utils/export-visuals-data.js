/**
 * Chart-ready bundle for security-swarm visuals (history.db, AI learning, semantic, regression).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createDatabase } from '../database/create-database.js';
import { resolveMastyfAiDbPath } from './mastyf-ai-db-path.js';
import { getAllActiveServerNames, loadAllCallRecords } from './db-aggregate.js';
import { resolveAttackLearningStatePath, resolveAiPendingSuggestionsPath, resolveAiLearningStatePath, resolveAiBaselinesPath } from '../ai/ai-paths.js';
import { DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';
import { getEffectiveSwarmDir, resolveTenantSwarmDir } from '../tenant/swarm-tenant-paths.js';
import { REPO_ROOT } from './swarm-artifacts.js';
import { loadSemanticAuditRecordsAsync } from '../ai/semantic-audit-store.js';
import { buildSemanticVisualsFromRecords } from './semantic-visuals.js';
import { isSwarmSessionActiveForTenant, isStrictLiveDashboard } from './swarm-session.js';
import { fillTimeSeries, filterRecordsInWindow, generateTimeBuckets, parseRecordTimestamp, parseWindowDays, windowRangeMs, } from './time-buckets.js';
import { buildChartMeta } from './chart-meta.js';
const RULE_GLOSSARY = {
    'request-prompt-injection': 'Prompt injection in tool args',
    'path-traversal': 'Path traversal',
    'secret-leak': 'Secret leak',
    'sql-injection': 'SQL injection',
    'shell-injection': 'Shell injection',
    'path-guard': 'Path guard',
    'semantic-shell-guard': 'Semantic shell guard',
    'secret-scan': 'Secret scan',
};
function percentile(sorted, p) {
    if (!sorted.length)
        return 0;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx] ?? 0;
}
function buildHourlyBuckets(records, sinceMs, endMs) {
    const buckets = generateTimeBuckets(sinceMs, endMs, 'hour');
    const rawMap = new Map();
    for (const r of records) {
        const t = parseRecordTimestamp(r.timestamp);
        if (!Number.isFinite(t) || t < sinceMs || t > endMs)
            continue;
        const hour = Math.floor(t / 3_600_000) * 3_600_000;
        const list = rawMap.get(hour) ?? [];
        list.push(r);
        rawMap.set(hour, list);
    }
    const rawHourly = [...rawMap.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([hourMs, recs]) => {
        let blocked = 0;
        let costUsd = 0;
        const latencies = [];
        for (const r of recs) {
            if (r.blocked)
                blocked++;
            if (r.costUsd)
                costUsd += r.costUsd;
            if (r.durationMs)
                latencies.push(r.durationMs);
        }
        latencies.sort((a, b) => a - b);
        const total = recs.length;
        return {
            hourStart: new Date(hourMs).toISOString(),
            calls: total,
            blocked,
            passed: total - blocked,
            passRatePct: total ? Math.round(((total - blocked) / total) * 1000) / 10 : 0,
            costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
            latencyP50Ms: percentile(latencies, 50),
            latencyP95Ms: percentile(latencies, 95),
        };
    });
    const filled = fillTimeSeries(rawHourly, 'hourStart', buckets, ['calls', 'blocked', 'passed']);
    const hourly = filled.points.map((p) => {
        const existing = rawHourly.find((h) => h.hourStart === p.hourStart);
        if (existing)
            return existing;
        return {
            hourStart: String(p.hourStart),
            calls: 0,
            blocked: 0,
            passed: 0,
            passRatePct: 0,
            costUsd: 0,
            latencyP50Ms: 0,
            latencyP95Ms: 0,
        };
    });
    return { hourly, sparse: filled.sparse };
}
function loadAttackLearningState(tenantId) {
    const p = resolveAttackLearningStatePath(tenantId);
    if (!existsSync(p))
        return null;
    try {
        return JSON.parse(readFileSync(p, 'utf-8'));
    }
    catch {
        return null;
    }
}
function loadSuggestionEngineSlice(tenantId) {
    const learningPath = resolveAiLearningStatePath(tenantId);
    let learning = null;
    if (existsSync(learningPath)) {
        try {
            learning = JSON.parse(readFileSync(learningPath, 'utf-8'));
        }
        catch { /* ignore */ }
    }
    let baselinesCount = learning?.baselinesLearned ?? 0;
    const baselinesPath = resolveAiBaselinesPath(tenantId);
    if (existsSync(baselinesPath)) {
        try {
            const raw = JSON.parse(readFileSync(baselinesPath, 'utf-8'));
            if (Array.isArray(raw))
                baselinesCount = raw.length;
            else if (Array.isArray(raw.baselines))
                baselinesCount = raw.baselines.length;
        }
        catch { /* ignore */ }
    }
    if (!learning?.learningInitialized && baselinesCount === 0)
        return undefined;
    return {
        learningInitialized: learning?.learningInitialized ?? false,
        cyclesCompleted: learning?.cyclesCompleted ?? 0,
        baselinesCount,
        recordsAnalyzed: learning?.recordsAnalyzed ?? 0,
        suggestionsGenerated: learning?.suggestionsGenerated ?? 0,
    };
}
function loadPendingSuggestionCount(tenantId) {
    const pendingPath = resolveAiPendingSuggestionsPath(tenantId);
    if (!existsSync(pendingPath))
        return 0;
    try {
        const raw = JSON.parse(readFileSync(pendingPath, 'utf-8'));
        return Array.isArray(raw.suggestions) ? raw.suggestions.length : 0;
    }
    catch {
        return 0;
    }
}
function blocksPerHourFromTraffic(hourly) {
    return hourly
        .filter((h) => h.blocked > 0)
        .map((h, i) => ({ t: i * 3_600_000, value: h.blocked }));
}
function ruleToolPairsFromHistory(ruleCounts) {
    return [...ruleCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([rule, count]) => ({
        key: `${rule}:*`,
        rule,
        tool: '*',
        count,
    }));
}
function instantLearningFromHistory(totalBlocked, hourly, ruleCounts, pendingSuggestions, suggestionEngine) {
    return {
        source: 'history-db-fallback',
        totalEvents: totalBlocked,
        queuedSuggestions: pendingSuggestions,
        blocksPerMinute: blocksPerHourFromTraffic(hourly),
        ruleToolPairs: ruleToolPairsFromHistory(ruleCounts),
        classConfidence: [],
        suggestionEngine,
    };
}
function attackStateHasChartSeries(state) {
    const pairs = Object.keys(state.ruleToolCounts ?? {}).length;
    const recent = state.recentBlocks?.length ?? 0;
    return pairs > 0 || recent > 0;
}
function blocksPerMinuteFromRecent(state) {
    const blocks = state.recentBlocks ?? [];
    if (!blocks.length)
        return [];
    const minTs = Math.min(...blocks.map((b) => new Date(b.ts).getTime()));
    const bucketMs = 60_000;
    const counts = new Map();
    for (const b of blocks) {
        const t = new Date(b.ts).getTime();
        const slot = Math.floor((t - minTs) / bucketMs) * bucketMs;
        counts.set(slot, (counts.get(slot) || 0) + 1);
    }
    return [...counts.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([t, value]) => ({ t, value }));
}
function loadJsonSafe(path) {
    if (!existsSync(path))
        return null;
    try {
        return JSON.parse(readFileSync(path, 'utf-8'));
    }
    catch {
        return null;
    }
}
export async function buildVisualsData(opts = {}) {
    const windowDays = parseWindowDays(opts.windowDays ?? 7);
    const tenantId = opts.tenantId || DEFAULT_TENANT_ID;
    const swarmDir = getEffectiveSwarmDir(tenantId);
    const swarmSessionLive = isSwarmSessionActiveForTenant(tenantId);
    const dbPath = opts.dbPath ?? resolveMastyfAiDbPath();
    const { startMs, endMs } = windowRangeMs(windowDays);
    const sinceMs = startMs;
    const emptyReasons = {};
    let allRecords = [];
    let ownDb = false;
    let db = opts.historyDb;
    try {
        if (!db) {
            db = await createDatabase(dbPath);
            await db.initialize();
            ownDb = true;
        }
        const servers = await getAllActiveServerNames(db, tenantId);
        allRecords = await loadAllCallRecords(db, servers, tenantId);
    }
    catch (err) {
        emptyReasons.traffic = `history.db: ${err instanceof Error ? err.message : String(err)}`;
    }
    finally {
        if (ownDb && db?.close) {
            await db.close();
        }
    }
    const windowRecords = filterRecordsInWindow(allRecords, sinceMs, endMs);
    const { hourly, sparse: trafficSparse } = buildHourlyBuckets(windowRecords, sinceMs, endMs);
    const serverMap = new Map();
    const toolCounts = new Map();
    const ruleCounts = new Map();
    for (const r of windowRecords) {
        const s = r.serverName || 'unknown';
        const list = serverMap.get(s) ?? [];
        list.push(r);
        serverMap.set(s, list);
        const tool = r.toolName || '(unknown)';
        toolCounts.set(tool, (toolCounts.get(tool) || 0) + 1);
        if (r.blocked && r.blockRule) {
            ruleCounts.set(r.blockRule, (ruleCounts.get(r.blockRule) || 0) + 1);
        }
    }
    const byServer = [...serverMap.entries()].map(([serverName, recs]) => {
        let blocked = 0;
        let costUsd = 0;
        const latencies = [];
        for (const r of recs) {
            if (r.blocked)
                blocked++;
            if (r.costUsd)
                costUsd += r.costUsd;
            if (r.durationMs)
                latencies.push(r.durationMs);
        }
        latencies.sort((a, b) => a - b);
        return {
            serverName,
            calls: recs.length,
            blocked,
            costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
            latencyP50Ms: percentile(latencies, 50),
            latencyP95Ms: percentile(latencies, 95),
        };
    }).sort((a, b) => b.calls - a.calls);
    const totalBlocked = windowRecords.filter((r) => r.blocked).length;
    if (!windowRecords.length) {
        const windowLabel = windowDays <= 1 / 24 ? '1h' : windowDays <= 1 ? '24h' : `${Math.round(windowDays)}d`;
        emptyReasons.traffic =
            `No proxied calls in the last ${windowLabel} — widen the dashboard time window or route MCP through Mastyf AI (proxy and dashboard must share MASTYF_AI_DB_PATH).`;
    }
    const attackState = loadAttackLearningState(tenantId);
    const suggestionEngine = loadSuggestionEngineSlice(tenantId);
    const pendingSuggestions = loadPendingSuggestionCount(tenantId);
    let instantLearning = {
        source: 'none',
        totalEvents: 0,
        queuedSuggestions: pendingSuggestions,
        blocksPerMinute: [],
        ruleToolPairs: [],
        classConfidence: [],
        suggestionEngine,
    };
    if (attackState && attackState.totalEvents > 0 && attackStateHasChartSeries(attackState)) {
        const pairs = [];
        for (const [key, stats] of Object.entries(attackState.ruleToolCounts ?? {})) {
            const [rule, tool] = key.split(':');
            pairs.push({ key, rule: rule || key, tool: tool || '?', count: stats.count });
        }
        pairs.sort((a, b) => b.count - a.count);
        instantLearning = {
            source: 'live',
            totalEvents: attackState.totalEvents,
            queuedSuggestions: pendingSuggestions || (attackState.queuedSuggestionKeys?.length ?? 0),
            blocksPerMinute: blocksPerMinuteFromRecent(attackState),
            ruleToolPairs: pairs.slice(0, 20),
            classConfidence: Object.entries(attackState.knownClassConfidence ?? {}).map(([cls, confidence]) => ({
                class: cls,
                confidence,
            })),
            suggestionEngine,
        };
    }
    else if (totalBlocked > 0) {
        instantLearning = instantLearningFromHistory(totalBlocked, hourly, ruleCounts, pendingSuggestions, suggestionEngine);
        emptyReasons.instantLearning = attackState?.totalEvents
            ? 'Attack-learning counters exist but chart series are empty — showing history.db block trends.'
            : 'Using history.db block counts — instant attack-learning state will populate after live proxy blocks.';
    }
    else {
        emptyReasons.instantLearning =
            'No live attack-learning state yet — blocks from the proxy will populate ~/.mastyf-ai/.attack-learning-state.json.';
    }
    const semanticRecords = await loadSemanticAuditRecordsAsync({
        tenantId,
        sinceMs: Math.max(windowDays, 30) * 24 * 60 * 60 * 1000,
        limit: 2000,
    });
    const semanticSlice = buildSemanticVisualsFromRecords(semanticRecords);
    if (!semanticSlice.hasData) {
        emptyReasons.semantic =
            'No live semantic audit outcomes in the last 30 days — enable MASTYF_AI_LLM_ENABLED + MASTYF_AI_SEMANTIC_ASYNC on the proxy and route MCP traffic through Mastyf AI.';
    }
    let latest = null;
    let corpus = null;
    let userSession = null;
    let job = null;
    if (swarmSessionLive || !isStrictLiveDashboard()) {
        latest = loadJsonSafe(join(swarmDir, 'latest.json'));
        corpus = loadJsonSafe(join(REPO_ROOT, 'corpus-eval-report.json'));
        userSession = loadJsonSafe(join(swarmDir, 'user-servers-session.json'));
        job = loadJsonSafe(join(swarmDir, 'job.json'));
    }
    else {
        emptyReasons.regression =
            'Batch regression data appears after you run Security Swarm in this dashboard session.';
        emptyReasons.pipeline = emptyReasons.regression;
    }
    const phases = [
        { id: 'preflight', label: 'Preflight', progressPct: 5 },
        { id: 'live-mcp', label: 'Live MCP', progressPct: 25 },
        { id: 'traffic', label: 'Traffic', progressPct: 42 },
        { id: 'swarm', label: 'Swarm gates', progressPct: 75 },
        { id: 'visuals', label: 'Visuals', progressPct: 88 },
    ];
    const timings = latest?.timings;
    const chartMeta = buildChartMeta({
        windowDays,
        recordCount: windowRecords.length,
        sparse: trafficSparse,
        dataSources: ['history.db'],
        emptyReason: windowRecords.length === 0 ? emptyReasons.traffic : undefined,
    });
    return {
        generatedAt: chartMeta.generatedAt,
        windowDays,
        meta: {
            dbPath,
            tenantId,
            hasTraffic: windowRecords.length > 0,
            hasInstantLearning: instantLearning.source === 'live' || instantLearning.source === 'history-db-fallback',
            hasSemantic: semanticSlice.hasData,
            swarmSessionLive,
            recordCount: chartMeta.recordCount,
            sparse: chartMeta.sparse,
            window: chartMeta.window,
            generatedAt: chartMeta.generatedAt,
            dataSources: {
                traffic: windowRecords.length > 0 ? 'history.db' : 'none',
                semantic: semanticSlice.hasData ? 'semantic-audit-store' : 'none',
                regression: swarmSessionLive && latest ? 'session-swarm' : 'none',
                pipeline: swarmSessionLive && job ? 'session-swarm' : 'none',
            },
            emptyReasons,
        },
        traffic: {
            hasData: windowRecords.length > 0,
            totalCalls: windowRecords.length,
            totalBlocked,
            hourly,
            byServer,
            topTools: [...toolCounts.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 12)
                .map(([tool, count]) => ({ tool, count })),
            topBlockRules: [...ruleCounts.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([rule, count]) => ({
                rule,
                count,
                plainEnglish: RULE_GLOSSARY[rule] || rule,
            })),
        },
        instantLearning,
        semantic: {
            hasData: semanticSlice.hasData,
            totals: semanticSlice.totals,
            confidenceBuckets: semanticSlice.confidenceBuckets,
            labelMix: semanticSlice.labelMix,
            avgFlagConfidence: semanticSlice.avgFlagConfidence,
        },
        regression: {
            gates: latest?.gates ?? null,
            overall: latest?.overall != null ? Boolean(latest.overall) : null,
            categoryRecall: (corpus?.byCategory ?? [])
                .filter((c) => c.category !== 'benign')
                .map((c) => ({
                category: c.category,
                recallPct: Math.round((c.recall ?? 0) * 1000) / 10,
                total: c.total ?? 0,
            })),
            userServers: (userSession?.servers ?? []).map((s) => ({
                serverName: s.serverName,
                status: s.status,
                toolCount: s.toolCount ?? 0,
            })),
        },
        pipeline: {
            phases,
            jobState: job?.state ?? null,
            stepTimings: timings?.steps ?? [],
            totalSec: timings?.totalSec ?? 0,
        },
    };
}
export async function writeVisualsData(opts) {
    const tenantId = opts?.tenantId || DEFAULT_TENANT_ID;
    const outDir = resolveTenantSwarmDir(tenantId);
    mkdirSync(outDir, { recursive: true });
    const bundle = await buildVisualsData({ ...opts, tenantId });
    const path = join(outDir, 'visuals-data.json');
    writeFileSync(path, JSON.stringify(bundle, null, 2) + '\n', 'utf-8');
    return bundle;
}
export function readVisualsData(tenantId) {
    const path = join(getEffectiveSwarmDir(tenantId || DEFAULT_TENANT_ID), 'visuals-data.json');
    return loadJsonSafe(path);
}
//# sourceMappingURL=export-visuals-data.js.map