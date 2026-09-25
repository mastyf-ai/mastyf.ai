/**
 * Data Fetcher — reads from HistoryDatabase + AI files + LLM for descriptive analysis.
 */
import { HistoryDatabase } from '../database/history-db.js';
import { aggregateInstancesByServer, getAllActiveServerNames, loadAllCallRecords, securityRowFromScan, summarizeRecords, } from '../utils/db-aggregate.js';
import { getRuntimeModelPricing } from '../services/runtime-model-pricing.js';
import { computeCostTrend, fetchCircuitBreakerStates, fetchDashboardMetrics, loadPolicySnapshot, } from '../utils/tui-sources.js';
import { readFileSync, existsSync } from 'fs';
import { resolveMastyfAiDbPath } from '../utils/mastyf-ai-db-path.js';
import { ensureProFeature } from '../license/enforce-pro.js';
import { getLicenseClient } from '../license/license-client.js';
import { isCiLicenseBypass } from '../license/feature-tiers.js';
import { isCiTokenCached } from '../license/ci-token.js';
import { resolveAiLearningStatePath, resolveAiPendingSuggestionsPath, resolveAiReportPath, resolveAiBaselinesPath, } from '../ai/ai-paths.js';
import { computeBurnRatePerHour, computeProjectedMonthly } from '../utils/cost-metrics.js';
import { isAiLearningEnabled } from '../utils/ai-enabled.js';
import { resolveTenantFromEnv } from '../tenant/resolve-tenant.js';
import { Logger } from '../utils/logger.js';
import { homedir } from 'os';
import { join } from 'path';
const MASTYF_AI_DIR = join(homedir(), '.mastyf-ai');
export class DataFetcher {
    db;
    dbPath;
    cache = null;
    listeners = new Set();
    pollTimer = null;
    lastAnalysis = '';
    dashboardUrl;
    ws = null;
    wsConnected = false;
    learningInFlight = false;
    learningRan = false;
    lastFetchError = null;
    dbReadOnly = false;
    constructor(dashboardUrl) {
        const requestedPath = resolveMastyfAiDbPath();
        this.db = new HistoryDatabase(requestedPath, { readOnly: true });
        this.dbPath = this.db.getDbPath();
        this.dbReadOnly = this.db.isReadOnly();
        this.dashboardUrl = dashboardUrl || process.env.MASTYF_AI_DASHBOARD_URL;
    }
    getData() { return this.cache; }
    getDbPath() { return this.dbPath; }
    isWsConnected() { return this.wsConnected; }
    onChange(cb) { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
    notify() { for (const l of this.listeners) {
        try {
            l();
        }
        catch { }
    } }
    connectWebSocket() {
        const base = this.dashboardUrl || process.env.MASTYF_AI_DASHBOARD_URL || 'http://127.0.0.1:4000';
        let wsUrl;
        try {
            const u = new URL(base);
            u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
            u.pathname = '/ws';
            wsUrl = u.toString();
        }
        catch {
            return;
        }
        void import('ws').then(({ default: WebSocket }) => {
            const socket = new WebSocket(wsUrl);
            this.ws = socket;
            socket.on('open', () => {
                this.wsConnected = true;
                socket.send(JSON.stringify({
                    type: 'subscribe',
                    channels: ['policy', 'health', 'metrics', 'audit', 'ai', 'cost', 'instances'],
                }));
                this.notify();
            });
            socket.on('message', () => {
                this.fetchAll().catch(() => { });
            });
            socket.on('close', () => {
                this.wsConnected = false;
                this.notify();
            });
            socket.on('error', () => {
                this.wsConnected = false;
            });
        }).catch(() => { });
    }
    /** Re-open read-only handle so WAL commits from proxy/demo are visible while polling. */
    refreshReadOnlyConnection() {
        if (!this.dbReadOnly)
            return;
        const path = resolveMastyfAiDbPath();
        try {
            this.db.close();
        }
        catch { }
        this.db = new HistoryDatabase(path, { readOnly: true });
        this.dbPath = this.db.getDbPath();
    }
    async fetchAll(opts) {
        try {
            if (this.dbReadOnly) {
                this.refreshReadOnlyConnection();
            }
            const tenantId = resolveTenantFromEnv();
            const servers = await getAllActiveServerNames(this.db, tenantId);
            const allRecords = await loadAllCallRecords(this.db, servers, tenantId);
            const sum = summarizeRecords(allRecords);
            let totalRequests = sum.total;
            let blockedCount = sum.blocked;
            let costUSD = sum.costUsd;
            let avgLatency = totalRequests > 0 ? Math.round(sum.totalLatency / totalRequests) : 0;
            let passRate = totalRequests > 0 ? Math.round((sum.passed / totalRequests) * 100) : 100;
            const [cbStates, dashboardMetrics, policySnap] = await Promise.all([
                fetchCircuitBreakerStates(),
                this.dashboardUrl ? fetchDashboardMetrics(this.dashboardUrl) : Promise.resolve(null),
                Promise.resolve(loadPolicySnapshot()),
            ]);
            // Prefer DB snapshot; only fill gaps from dashboard API (avoid WS/proxy zeros wiping live DB data)
            if (dashboardMetrics && totalRequests === 0) {
                if (dashboardMetrics.totalRequests != null)
                    totalRequests = dashboardMetrics.totalRequests;
                if (dashboardMetrics.blockedRequests != null)
                    blockedCount = dashboardMetrics.blockedRequests;
                if (dashboardMetrics.totalCost != null)
                    costUSD = dashboardMetrics.totalCost;
                if (dashboardMetrics.avgLatencyMs != null)
                    avgLatency = dashboardMetrics.avgLatencyMs;
                if (dashboardMetrics.passRate != null)
                    passRate = dashboardMetrics.passRate;
            }
            const secReports = [];
            let totalScore = 0;
            let activeThreats = 0;
            let lastScan = 'N/A';
            for (const srv of servers) {
                const scan = await this.db.getLatestSecurityScan(srv, tenantId);
                if (scan) {
                    const row = securityRowFromScan(scan, srv);
                    secReports.push({ name: row.name, score: row.score, cves: row.cves, critical: row.critical, auth: row.auth });
                    totalScore += row.score;
                    activeThreats += row.critical + row.high;
                    if (scan.created_at && (lastScan === 'N/A' || scan.created_at > lastScan)) {
                        lastScan = scan.created_at;
                    }
                }
                else {
                    secReports.push({ name: srv, score: 0, cves: 0, critical: 0, auth: false });
                }
            }
            const activePricing = await getRuntimeModelPricing().getActivePricing();
            const pricingModel = activePricing
                ? `${activePricing.displayName} — $${activePricing.inputPerM}/M in, $${activePricing.outputPerM}/M out (${activePricing.source}${activePricing.isLive ? ', live' : ''})`
                : sum.pricedCalls > 0
                    ? `per-call rates (${sum.models.join(', ') || 'mixed'})`
                    : 'unpriced — open Cline/Cursor or set MASTYF_AI_MODEL';
            const costReports = [];
            for (const srv of servers) {
                const srecs = allRecords.filter((r) => r.serverName === srv);
                const srvSum = summarizeRecords(srecs);
                costReports.push({
                    name: srv,
                    tokens: srvSum.totalInput + srvSum.totalOutput,
                    cost: srvSum.costUsd,
                    trend: computeCostTrend(srecs),
                    unpriced: srvSum.unpricedCalls,
                    models: srvSum.models,
                });
            }
            costUSD = sum.costUsd;
            const healthReports = [];
            let totalTools = 0;
            for (const srv of servers) {
                const srecs = allRecords.filter((r) => r.serverName === srv);
                const callLat = srecs.length > 0 ? Math.round(srecs.reduce((s, r) => s + (r.durationMs || 0), 0) / srecs.length) : 0;
                const sr = await this.db.getRecentSuccessRate(srv, tenantId);
                const hc = await this.db.getLatestHealthCheck(srv, tenantId);
                const latency = hc?.latency_ms ?? callLat;
                const tools = hc?.tool_count ?? 0;
                totalTools += tools;
                const cb = cbStates.get(srv) ?? 'closed';
                healthReports.push({
                    name: srv,
                    latency,
                    successRate: (sr ?? 1) * 100,
                    tools,
                    circuitBreaker: cb,
                });
            }
            const sortedAudit = [...allRecords].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
            const auditEvents = sortedAudit.slice(0, 15).map((r) => ({
                timestamp: r.timestamp || '', server_name: r.serverName, tool_name: r.toolName,
                action: r.blocked ? 'block' : 'pass', rule: r.blockRule, reason: r.blockReason,
                request_tokens: r.requestTokens || 0, total_tokens: r.totalTokens || 0,
            }));
            let suggestions = [];
            let threats = [];
            let baselines = [];
            const aiState = this.loadLearningDisplay();
            try {
                const baselinePath = resolveAiBaselinesPath();
                if (existsSync(baselinePath)) {
                    const parsed = JSON.parse(readFileSync(baselinePath, 'utf-8'));
                    if (Array.isArray(parsed.baselines))
                        baselines = parsed.baselines;
                }
            }
            catch { }
            try {
                const pendingPath = resolveAiPendingSuggestionsPath();
                if (existsSync(pendingPath)) {
                    const pending = JSON.parse(readFileSync(pendingPath, 'utf-8'));
                    if (Array.isArray(pending.suggestions))
                        suggestions = pending.suggestions;
                }
            }
            catch { }
            // Threats from live learning state only — skip legacy seed file .threat-state.json
            if (aiState.learningInitialized && Array.isArray(aiState.threatIds)) {
                threats = (aiState.threatIds || []).map((id) => ({
                    id,
                    source: id.startsWith('osv-') ? 'OSV' : id.startsWith('gh-') ? 'GitHub' : 'NVD',
                    severity: 'HIGH',
                }));
            }
            const overallScore = secReports.length > 0 ? Math.round(totalScore / secReports.length) : 0;
            let savedReport = null;
            let analysis = '';
            // Always derive analysis from the current DB snapshot when we have traffic.
            // Saved ~/.mastyf-ai/.ai-report.json is often stale (e.g. single echo-test run).
            if (totalRequests > 0) {
                analysis = this.buildDeterministicAnalysis({
                    totalRequests,
                    blockedCount,
                    passRate,
                    costUSD,
                    avgLatency,
                    servers: secReports,
                    costServers: costReports,
                    healthServers: healthReports,
                    overallScore,
                    threats,
                    aiState,
                    policyMode: policySnap.mode,
                    activeRules: policySnap.activeRules,
                    suggestions,
                    auditEvents,
                    topTools: this.getTopTools(allRecords),
                });
            }
            else {
                try {
                    const reportPath = resolveAiReportPath();
                    if (existsSync(reportPath)) {
                        const parsed = JSON.parse(readFileSync(reportPath, 'utf-8'));
                        if (parsed.plainText)
                            analysis = parsed.plainText;
                        if (parsed.report)
                            savedReport = parsed.report;
                    }
                }
                catch { }
            }
            this.lastAnalysis = analysis;
            if (!opts?.skipLearning) {
                void this.ensureLearningCycle(allRecords.length);
            }
            const llmEnabled = process.env.MASTYF_AI_TUI_LLM !== 'false'
                && process.env.MASTYF_AI_LLM_ENABLED !== 'false'
                && this.tuiAiLearningAllowed();
            if (llmEnabled && totalRequests > 0) {
                const topTools = this.getTopTools(allRecords);
                const securityIssues = secReports.filter((r) => r.score < 70).map((r) => r.name);
                const prompt = this.buildAnalysisPrompt(totalRequests, costUSD, avgLatency, servers.length, threats, aiState, topTools, securityIssues, allRecords);
                import('../ai/llm-assistant.js').then(({ LlmAssistant }) => {
                    new LlmAssistant().generate('You are an MCP security operations analyst. Add a short "Analyst note" (3-4 sentences) after the facts below. Be direct. No disclaimers.', `${prompt}\n\n---\nExisting analysis:\n${analysis.slice(0, 2000)}`).then((result) => {
                        if (result?.text) {
                            const note = result.text.trim();
                            this.lastAnalysis = `${analysis}\n\nANALYST NOTE\n${note}`;
                            if (this.cache) {
                                this.cache.ai.analysis = this.lastAnalysis;
                                this.notify();
                            }
                        }
                    }).catch(() => { });
                }).catch(() => { });
            }
            const instances = aggregateInstancesByServer(allRecords, servers);
            // "Active" in overview = servers with recorded traffic (not just last-N-min heartbeat)
            const activeInstanceCount = instances.filter((i) => i.totalRequests > 0).length;
            const fleet = await this.loadFleetData();
            this.cache = {
                overview: {
                    totalInstances: instances.length,
                    activeInstances: activeInstanceCount,
                    totalRequests,
                    blockedRequests: blockedCount,
                    passRate,
                    totalCostUsd: costUSD,
                    burnRatePerHour: computeBurnRatePerHour(costUSD, allRecords),
                    avgLatencyMs: avgLatency,
                    activeServers: servers.length,
                    lastUpdated: new Date().toISOString(),
                },
                security: { servers: secReports, overallScore, worstOffenders: secReports.filter((r) => r.score < 50).map((r) => r.name), activeThreats: activeThreats + threats.length, lastScan },
                cost: {
                    servers: costReports,
                    totalCost: costUSD,
                    projectedMonthly: computeProjectedMonthly(costUSD, allRecords),
                    budgetAlerts: sum.unpricedCalls > 0
                        ? [`${sum.unpricedCalls} call(s) without resolved model pricing`]
                        : [],
                    pricingModel,
                    unpricedCalls: sum.unpricedCalls,
                    pricedCalls: sum.pricedCalls,
                },
                health: { servers: healthReports, atRisk: healthReports.filter((h) => h.latency > 200 || h.successRate < 70).map((h) => h.name), avgLatency, totalTools },
                ai: { suggestions, baselines, learningState: aiState, threats, report: savedReport, analysis },
                audit: { events: auditEvents, total: totalRequests, blocked: blockedCount, passed: sum.passed, flagged: 0 },
                policy: { mode: policySnap.mode, activeRules: policySnap.activeRules, autoGeneratedRules: policySnap.autoGeneratedRules, rules: policySnap.rules },
                instances,
                fleet,
                meta: {
                    dbPath: this.dbPath,
                    recordCount: allRecords.length,
                    wsConnected: this.wsConnected,
                    dbReadOnly: this.dbReadOnly,
                    fetchError: null,
                },
            };
            this.lastFetchError = null;
        }
        catch (err) {
            this.lastFetchError = err instanceof Error ? err.message : String(err);
            Logger.warn(`[TUI] fetchAll failed: ${this.lastFetchError}`);
            this.cache = {
                overview: { totalInstances: 0, activeInstances: 0, totalRequests: 0, blockedRequests: 0, passRate: 100, totalCostUsd: 0, burnRatePerHour: 0, avgLatencyMs: 0, activeServers: 0, lastUpdated: '' },
                security: { servers: [], overallScore: 0, worstOffenders: [], activeThreats: 0, lastScan: 'N/A' },
                cost: { servers: [], totalCost: 0, projectedMonthly: 0, budgetAlerts: [], pricingModel: '', unpricedCalls: 0, pricedCalls: 0 },
                health: { servers: [], atRisk: [], avgLatency: 0, totalTools: 0 },
                ai: { suggestions: [], baselines: [], learningState: this.loadLearningDisplay(), threats: [], report: null, analysis: '' },
                audit: { events: [], total: 0, blocked: 0, passed: 0, flagged: 0 },
                policy: { mode: 'none', activeRules: 0, autoGeneratedRules: [], rules: [] },
                instances: [],
                fleet: {
                    region: 'default',
                    source: 'error',
                    totalInstances: 0,
                    activeInstances: 0,
                    totalRequests: 0,
                    totalBlocked: 0,
                    totalCostUsd: 0,
                    rows: [],
                },
                meta: {
                    dbPath: this.dbPath,
                    recordCount: 0,
                    wsConnected: this.wsConnected,
                    dbReadOnly: this.dbReadOnly,
                    fetchError: this.lastFetchError,
                },
            };
        }
        this.notify();
        return this.cache;
    }
    async recordSuggestionOutcome(suggestion, action) {
        const { recordSuggestionOutcome } = await import('../ai/suggestion-engine.js');
        const { resolvePolicyPath } = await import('../utils/tui-sources.js');
        await recordSuggestionOutcome(suggestion.id || suggestion.ruleName || 'unknown', action, {
            ruleName: suggestion.ruleName || suggestion.id || 'unknown',
            source: suggestion.source || 'baseline',
            confidence: suggestion.confidence ?? 0.5,
            rule: suggestion.rule,
            policyPath: resolvePolicyPath(),
            userId: process.env.MASTYF_AI_TUI_USER || process.env.USER || 'tui',
        });
        await this.fetchAll();
    }
    loadLearningDisplay() {
        const empty = {
            adaptiveThreshold: 0.85,
            truePositiveRate: null,
            falsePositiveRate: null,
            moduleWeights: {},
            learningInitialized: false,
            lastCycleAt: null,
            cyclesCompleted: 0,
            recordsAnalyzed: 0,
            baselinesLearned: 0,
            suggestionsGenerated: 0,
            labeledOutcomes: 0,
        };
        try {
            const aiPath = resolveAiLearningStatePath();
            if (!existsSync(aiPath))
                return empty;
            const st = JSON.parse(readFileSync(aiPath, 'utf-8'));
            const outcomes = Array.isArray(st.outcomes) ? st.outcomes : [];
            const labeled = outcomes.filter((o) => o.action === 'applied' || o.action === 'rejected').length;
            const hasRates = labeled >= 5;
            return {
                adaptiveThreshold: typeof st.adaptiveThreshold === 'number' ? st.adaptiveThreshold : 0.85,
                truePositiveRate: hasRates ? st.truePositiveRate : null,
                falsePositiveRate: hasRates ? st.falsePositiveRate : null,
                moduleWeights: st.moduleWeights && Object.keys(st.moduleWeights).length > 0
                    ? st.moduleWeights
                    : {},
                learningInitialized: !!st.learningInitialized,
                lastCycleAt: st.lastCycleAt || null,
                cyclesCompleted: st.cyclesCompleted ?? 0,
                recordsAnalyzed: st.recordsAnalyzed ?? 0,
                baselinesLearned: st.baselinesLearned ?? 0,
                suggestionsGenerated: st.suggestionsGenerated ?? 0,
                labeledOutcomes: labeled,
            };
        }
        catch {
            return empty;
        }
    }
    async loadFleetData() {
        const empty = {
            region: 'local',
            source: 'none',
            totalInstances: 0,
            activeInstances: 0,
            totalRequests: 0,
            totalBlocked: 0,
            totalCostUsd: 0,
            rows: [],
        };
        try {
            await ensureProFeature('fleet');
        }
        catch {
            return empty;
        }
        const { getFleetStatus } = await import('../fleet/fleet-aggregator.js');
        const fleetReport = await getFleetStatus();
        return {
            region: fleetReport.region,
            source: fleetReport.source,
            totalInstances: fleetReport.totalInstances,
            activeInstances: fleetReport.activeInstances,
            totalRequests: fleetReport.totalRequests,
            totalBlocked: fleetReport.totalBlocked,
            totalCostUsd: fleetReport.totalCostUsd,
            rows: fleetReport.instances.map((i) => ({
                instanceId: i.instanceId,
                instanceName: i.instanceName,
                status: i.status,
                hostname: i.hostname,
                region: i.region,
                totalRequests: i.totalRequests,
                blockedRequests: i.blockedRequests,
                totalCostUsd: i.totalCostUsd,
            })),
        };
    }
    tuiAiLearningAllowed() {
        if (isCiLicenseBypass() || isCiTokenCached())
            return true;
        return getLicenseClient().hasFeature('ai');
    }
    async ensureLearningCycle(recordCount) {
        if (this.dbReadOnly || !isAiLearningEnabled() || recordCount === 0)
            return;
        if (!this.tuiAiLearningAllowed())
            return;
        if (process.env.MASTYF_AI_TUI_SKIP_LEARNING === 'true')
            return;
        if (this.learningInFlight)
            return;
        const state = this.loadLearningDisplay();
        const staleMs = parseInt(process.env.MASTYF_AI_TUI_LEARNING_INTERVAL_MS || '60000', 10);
        if (this.learningRan && state.lastCycleAt) {
            const age = Date.now() - new Date(state.lastCycleAt).getTime();
            if (age < staleMs)
                return;
        }
        this.learningInFlight = true;
        try {
            const { runLearningCycleForDb } = await import('../ai/suggestion-engine.js');
            await runLearningCycleForDb(this.db);
            this.learningRan = true;
            await this.fetchAll({ skipLearning: true });
        }
        catch {
            // Next poll will retry
        }
        finally {
            this.learningInFlight = false;
        }
    }
    getTopTools(records) {
        const map = new Map();
        for (const r of records) {
            const tn = r.toolName || 'unknown';
            if (!map.has(tn))
                map.set(tn, { count: 0, totalTokens: 0 });
            const e = map.get(tn);
            e.count++;
            e.totalTokens += (r.totalTokens || 0);
        }
        return [...map.entries()]
            .map(([name, v]) => ({ name, count: v.count, totalTokens: v.totalTokens }))
            .sort((a, b) => b.totalTokens - a.totalTokens)
            .slice(0, 5);
    }
    buildDeterministicAnalysis(input) {
        const lines = [];
        lines.push('MCP Mastyf AI — Live Deployment Analysis');
        lines.push(`Generated: ${new Date().toISOString()}`);
        lines.push('');
        lines.push('TRAFFIC & POLICY');
        lines.push(`  Total tool calls: ${input.totalRequests}`);
        lines.push(`  Blocked: ${input.blockedCount}  Passed: ${input.totalRequests - input.blockedCount}`);
        lines.push(`  Pass rate: ${input.passRate.toFixed(1)}%`);
        lines.push(`  Policy mode: ${input.policyMode} (${input.activeRules} active rules)`);
        lines.push('');
        lines.push('COST');
        lines.push(`  Total cost: $${input.costUSD.toFixed(4)}`);
        lines.push(`  Average latency: ${input.avgLatency}ms`);
        for (const c of input.costServers) {
            lines.push(`  ${c.name}: $${c.cost.toFixed(4)}, ${c.tokens.toLocaleString()} tokens, trend ${c.trend}`);
        }
        lines.push('');
        lines.push('SECURITY');
        lines.push(`  Overall score: ${input.overallScore}/100`);
        for (const s of input.servers) {
            lines.push(`  ${s.name}: ${s.score}/100, ${s.cves} CVE(s), ${s.critical} critical, auth ${s.auth ? 'yes' : 'no'}`);
        }
        if (input.threats.length > 0) {
            lines.push('');
            lines.push('THREAT INTELLIGENCE');
            for (const t of input.threats.slice(0, 8)) {
                lines.push(`  ${t.id} (${t.source || 'unknown'}, ${t.severity || 'N/A'})`);
            }
        }
        lines.push('');
        lines.push('HEALTH');
        for (const h of input.healthServers) {
            lines.push(`  ${h.name}: ${h.latency}ms, ${h.successRate.toFixed(0)}% success, ${h.tools} tools, breaker ${h.circuitBreaker}`);
        }
        if (input.topTools.length > 0) {
            lines.push('');
            lines.push('TOP TOOLS BY USAGE');
            for (const t of input.topTools) {
                lines.push(`  ${t.name}: ${t.count} calls, ${t.totalTokens.toLocaleString()} tokens`);
            }
        }
        if (input.suggestions.length > 0) {
            lines.push('');
            lines.push('AI SUGGESTIONS (pending review)');
            for (const s of input.suggestions.slice(0, 8)) {
                const pct = ((s.confidence ?? 0) * 100).toFixed(0);
                lines.push(`  [${pct}%] ${s.ruleName || 'rule'} — ${(s.reason || '').slice(0, 80)}`);
            }
        }
        lines.push('');
        lines.push('AI LEARNING STATE');
        lines.push(`  Adaptive threshold: ${input.aiState.adaptiveThreshold.toFixed(2)}`);
        lines.push(`  Learning cycles: ${input.aiState.cyclesCompleted} (last: ${input.aiState.lastCycleAt || 'never'})`);
        lines.push(`  Baselines learned: ${input.aiState.baselinesLearned}`);
        if (input.aiState.truePositiveRate != null) {
            lines.push(`  True positive rate: ${(input.aiState.truePositiveRate * 100).toFixed(0)}%`);
            lines.push(`  False positive rate: ${((input.aiState.falsePositiveRate ?? 0) * 100).toFixed(0)}%`);
        }
        else {
            lines.push(`  True/false positive rates: N/A (${input.aiState.labeledOutcomes} labeled outcomes)`);
        }
        const recentBlocks = input.auditEvents.filter((e) => e.action === 'block').slice(0, 5);
        if (recentBlocks.length > 0) {
            lines.push('');
            lines.push('RECENT BLOCKS');
            for (const e of recentBlocks) {
                lines.push(`  ${e.server_name || '?'} / ${e.tool_name || '?'} — rule ${e.rule || 'unknown'}`);
            }
        }
        if (input.totalRequests === 0) {
            lines.push('');
            lines.push('No call records yet. Run the proxy or: pnpm run dogfood');
        }
        return lines.join('\n');
    }
    buildAnalysisPrompt(totalRequests, costUsd, avgLatency, serverCount, threats, aiState, topTools, securityIssues, records) {
        const toolLines = topTools.map(t => `  - ${t.name}: ${t.count} calls`).join('\n');
        const secLines = securityIssues.length > 0 ? `Security concerns: ${securityIssues.join(', ')}` : 'No critical security issues';
        const threatList = threats.slice(0, 3).map(t => t.id).join(', ');
        return `MCP Mastyf AI deployment summary:
- ${totalRequests} total tool calls across ${serverCount} server(s)
- Total cost: $${costUsd.toFixed(4)}
- Average latency: ${avgLatency}ms
- ${threats.length} active threat intelligence entries (${threatList})
- AI self-improvement: ${Math.round(aiState.truePositiveRate * 100)}% true positive rate, threshold ${aiState.adaptiveThreshold}
- Top tools by usage:\n${toolLines || '  No tools detected'}
- ${secLines}

Provide a brief operational security and cost assessment.`;
    }
    startPolling(ms = 3000) {
        this.pollTimer = setInterval(() => { this.fetchAll().catch(() => { }); }, ms);
        return this.pollTimer;
    }
    stop() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        if (this.ws) {
            try {
                this.ws.close();
            }
            catch { }
            this.ws = null;
        }
        this.listeners.clear();
        try {
            this.db.close();
        }
        catch { }
    }
}
//# sourceMappingURL=data-fetcher.js.map