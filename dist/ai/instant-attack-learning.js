/**
 * Per-block instant attack learning — sync stats + optional lightweight suggestions.
 * Complements debounced full learning cycles in block-learning.ts.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { attackGroupKey, attackMinBlocks, suggestFromBlockedGroup, } from './attack-pattern-learner.js';
import { resolveAttackLearningStatePath, resolveAiPendingSuggestionsPath } from './ai-paths.js';
import { attackClassFromBlockRule } from './threat-taxonomy.js';
import { LlmAssistant } from './llm-assistant.js';
import { isAiAutoApplyEnabled, isAiLearningEnabled } from '../utils/ai-enabled.js';
import { Logger } from '../utils/logger.js';
import { StructuredLogger } from '../utils/structured-logger.js';
import * as Metrics from '../utils/metrics.js';
import { broadcastDashboardEvent, emitFlowStep } from '../utils/dashboard-events.js';
import { resolveTenantId } from '../tenant/resolve-tenant.js';
import { getInstantLlmTimeoutMs, withSemanticTimeout } from '../utils/semantic-timeout.js';
const CRITICAL_RULES = new Set([
    'semantic-shell-guard',
    'secret-scan',
    'path-guard',
    'sensitive-path',
]);
let stateCacheByTenant = new Map();
let lastLlmInstantAt = 0;
let suggestionCounter = 0;
/** PostgreSQL-backed store (AuditTrailSync); falls back to local JSON file when unset. */
let sharedStore = null;
export function setAttackLearningSharedStore(store) {
    sharedStore = store;
}
function attackLearningTenantId(explicit) {
    return explicit || resolveTenantId();
}
function getTenantStateCache(tenantId) {
    return stateCacheByTenant.get(tenantId);
}
function setTenantStateCache(tenantId, state) {
    stateCacheByTenant.set(tenantId, state);
}
function instantLearningEnabled() {
    if (process.env.MASTYF_AI_AI_INSTANT_LEARNING === 'false')
        return false;
    return isAiLearningEnabled();
}
function instantLlmEnabled() {
    return process.env.MASTYF_AI_AI_INSTANT_LLM === 'true' && instantLearningEnabled();
}
function windowMs() {
    const n = parseInt(process.env.MASTYF_AI_AI_INSTANT_WINDOW_MS || '300000', 10);
    return Number.isFinite(n) && n > 0 ? n : 300_000;
}
function llmRateLimitMs() {
    const n = parseInt(process.env.MASTYF_AI_AI_INSTANT_LLM_RATE_MS || '60000', 10);
    return Number.isFinite(n) && n > 0 ? n : 60_000;
}
function emptyState() {
    return {
        version: 1,
        updatedAt: new Date().toISOString(),
        totalEvents: 0,
        ruleToolCounts: {},
        reasonNgrams: {},
        recentBlocks: [],
        queuedSuggestionKeys: [],
        knownClassConfidence: {},
    };
}
export function loadAttackLearningState(tenantId) {
    const tid = attackLearningTenantId(tenantId);
    const cached = getTenantStateCache(tid);
    if (cached)
        return cached;
    const path = resolveAttackLearningStatePath(tid);
    if (!existsSync(path)) {
        const empty = emptyState();
        setTenantStateCache(tid, empty);
        return empty;
    }
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf-8'));
        const state = { ...emptyState(), ...parsed, version: 1 };
        setTenantStateCache(tid, state);
        return state;
    }
    catch {
        const empty = emptyState();
        setTenantStateCache(tid, empty);
        return empty;
    }
}
/** Load from PostgreSQL shared store (call at bootstrap when MASTYF_AI_AUDIT_SYNC_ENABLED). */
export async function loadAttackLearningFromSharedStore(tenantId) {
    if (!sharedStore?.getAttackLearningState)
        return;
    const tid = attackLearningTenantId(tenantId);
    try {
        const remote = await sharedStore.getAttackLearningState(tid);
        if (!remote)
            return;
        const local = loadAttackLearningState(tid);
        const remoteTs = Date.parse(remote.updatedAt || '0');
        const localTs = Date.parse(local.updatedAt || '0');
        if (remoteTs >= localTs) {
            const merged = { ...emptyState(), ...remote, version: 1 };
            setTenantStateCache(tid, merged);
            saveAttackLearningState(merged, tid);
        }
        Logger.info(`[instant-learning] Loaded attack learning state from shared PostgreSQL store (tenant=${tid})`);
    }
    catch (err) {
        Logger.warn(`[instant-learning] Shared store load failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}
export function saveAttackLearningState(state, tenantId) {
    state.updatedAt = new Date().toISOString();
    const tid = attackLearningTenantId(tenantId);
    setTenantStateCache(tid, state);
    if (sharedStore?.persistAttackLearningState) {
        try {
            const p = sharedStore.persistAttackLearningState(state, tid);
            if (p && typeof p.catch === 'function') {
                void p.catch((err) => {
                    Logger.debug(`[instant-learning] Shared PG persist failed: ${err instanceof Error ? err.message : String(err)}`);
                });
            }
        }
        catch (err) {
            Logger.debug(`[instant-learning] Shared PG persist failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    try {
        const path = resolveAttackLearningStatePath(tid);
        const dir = dirname(path);
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
        writeFileSync(path, JSON.stringify(state, null, 2));
    }
    catch (err) {
        Logger.debug(`[instant-learning] Failed to persist state: ${err instanceof Error ? err.message : String(err)}`);
    }
}
/** Extract 2–3 word n-grams from block reasons for rolling pattern stats. */
export function extractReasonNgrams(reason) {
    const tokens = reason
        .toLowerCase()
        .replace(/[^a-z0-9./_-]+/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 2);
    const ngrams = [];
    for (let n = 2; n <= 3; n++) {
        for (let i = 0; i <= tokens.length - n; i++) {
            ngrams.push(tokens.slice(i, i + n).join(' '));
        }
    }
    return ngrams;
}
function pruneWindow(state, now) {
    const cutoff = now - windowMs();
    state.recentBlocks = state.recentBlocks.filter((b) => b.ts >= cutoff);
}
function blocksInWindow(state, blockRule, toolName) {
    return state.recentBlocks.filter((b) => b.blockRule === blockRule && b.toolName === toolName);
}
function toProxyRecords(blocks) {
    return blocks.map((b) => ({
        serverName: b.serverName,
        toolName: b.toolName,
        requestTokens: 0,
        responseTokens: 0,
        totalTokens: 0,
        durationMs: 0,
        timestamp: new Date(b.ts).toISOString(),
        blocked: true,
        blockRule: b.blockRule,
        blockReason: b.blockReason,
    }));
}
export function queuePendingAttackSuggestion(suggestion, opts) {
    return mergePendingSuggestion(suggestion, opts?.confidenceBoost ?? 0, opts?.tenantId, opts?.source ?? 'attack');
}
function mergePendingSuggestion(suggestion, confidenceBoost = 0, tenantId, source = 'attack') {
    const path = resolveAiPendingSuggestionsPath(tenantId);
    const dir = dirname(path);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    let pending = { updatedAt: new Date().toISOString(), suggestions: [] };
    if (existsSync(path)) {
        try {
            pending = JSON.parse(readFileSync(path, 'utf-8'));
        }
        catch {
            /* reset */
        }
    }
    const ruleName = suggestion.rule.name;
    if (pending.suggestions.some((s) => s.ruleName === ruleName)) {
        return false;
    }
    const confidence = Math.min(suggestion.confidence + confidenceBoost, 0.99);
    pending.suggestions.push({
        id: `instant-attack-${suggestionCounter++}`,
        ruleName,
        rule: suggestion.rule,
        confidence,
        reason: `${suggestion.reason} (instant learning)`,
        source,
    });
    pending.updatedAt = new Date().toISOString();
    try {
        writeFileSync(path, JSON.stringify(pending, null, 2));
    }
    catch (err) {
        Logger.debug(`[instant-learning] Failed to queue suggestion: ${err instanceof Error ? err.message : String(err)}`);
        return false;
    }
    broadcastDashboardEvent({
        type: 'ai:suggestions',
        payload: { suggestions: pending.suggestions, instant: true },
        timestamp: Date.now(),
    });
    emitFlowStep({
        kind: 'ai_suggestion',
        title: `AI suggestion: ${ruleName}`,
        summary: suggestion.reason || 'Instant attack pattern queued',
        severity: 'info',
        metadata: { ruleName, confidence, source: 'attack' },
    });
    return true;
}
async function maybeRunInstantLlm(event, attackClass) {
    if (!instantLlmEnabled() || !CRITICAL_RULES.has(event.block_rule)) {
        return { confidenceBoost: 0 };
    }
    const now = Date.now();
    if (now - lastLlmInstantAt < llmRateLimitMs())
        return { confidenceBoost: 0 };
    lastLlmInstantAt = now;
    const tid = attackLearningTenantId(event.tenantId);
    const assistant = new LlmAssistant();
    const systemPrompt = 'Classify MCP tool-call blocks and suggest argPatterns. Reply ONLY JSON: {"attackClass":"...","confidence":0.0-1.0,"argPatterns":[{"field":"*","patterns":["regex"]}]}';
    const userPrompt = JSON.stringify({
        block_rule: event.block_rule,
        tool: event.toolName,
        reason: event.block_reason.slice(0, 500),
        snippets: event.argSnippets?.slice(0, 3),
    });
    const result = await withSemanticTimeout('instant-attack-llm', () => assistant.generate(systemPrompt, userPrompt), null, getInstantLlmTimeoutMs());
    if (!result?.text)
        return { confidenceBoost: 0 };
    try {
        const parsed = JSON.parse(result.text);
        const cls = parsed.attackClass || attackClass;
        const conf = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;
        const state = loadAttackLearningState(tid);
        state.knownClassConfidence[cls] = Math.max(state.knownClassConfidence[cls] || 0, conf);
        saveAttackLearningState(state, tid);
        const argPatterns = (parsed.argPatterns || [])
            .filter((ap) => ap.patterns?.length)
            .map((ap) => ({
            field: ap.field || '*',
            patterns: (ap.patterns || []).slice(0, 3),
        }));
        return {
            confidenceBoost: conf > 0.7 ? 0.05 : 0,
            argPatterns: argPatterns.length ? argPatterns : undefined,
        };
    }
    catch {
        Logger.debug('[instant-learning] LLM classifier returned non-JSON');
        return { confidenceBoost: 0 };
    }
}
function bumpKnownClassConfidence(state, blockRule) {
    const cls = attackClassFromBlockRule(blockRule);
    if (!cls)
        return 0;
    const prev = state.knownClassConfidence[cls] || 0.4;
    const next = Math.min(prev + 0.06, 0.95);
    state.knownClassConfidence[cls] = next;
    return next - prev;
}
/**
 * Synchronous per-block learning: rolling stats, state file, optional instant suggestion queue.
 */
export function recordInstantBlockEvent(event) {
    if (!instantLearningEnabled()) {
        return { queued: false, windowCount: 0 };
    }
    const tid = attackLearningTenantId(event.tenantId);
    const now = Date.now();
    const state = loadAttackLearningState(tid);
    state.totalEvents += 1;
    const groupKey = attackGroupKey(event.block_rule, event.toolName);
    const stats = state.ruleToolCounts[groupKey] || {
        count: 0,
        lastAt: new Date().toISOString(),
        reasons: [],
    };
    stats.count += 1;
    stats.lastAt = new Date().toISOString();
    if (event.block_reason) {
        stats.reasons.push(event.block_reason.slice(0, 256));
        if (stats.reasons.length > 20)
            stats.reasons = stats.reasons.slice(-20);
    }
    state.ruleToolCounts[groupKey] = stats;
    for (const ng of extractReasonNgrams(event.block_reason)) {
        state.reasonNgrams[ng] = (state.reasonNgrams[ng] || 0) + 1;
    }
    state.recentBlocks.push({
        ts: now,
        serverName: event.serverName,
        toolName: event.toolName,
        blockRule: event.block_rule,
        blockReason: event.block_reason,
        argsFingerprint: event.argsFingerprint,
        argSnippets: event.argSnippets,
        arguments: event.arguments,
    });
    pruneWindow(state, now);
    saveAttackLearningState(state, tid);
    const windowBlocks = blocksInWindow(state, event.block_rule, event.toolName);
    const minBlocks = attackMinBlocks();
    let queued = false;
    let outcome = 'stats_only';
    const confidenceBoost = bumpKnownClassConfidence(state, event.block_rule);
    saveAttackLearningState(state, tid);
    if (windowBlocks.length >= minBlocks && !state.queuedSuggestionKeys.includes(groupKey)) {
        const suggestion = suggestFromBlockedGroup(event.block_rule, event.toolName, toProxyRecords(windowBlocks));
        if (suggestion) {
            queued = mergePendingSuggestion(suggestion, confidenceBoost, tid);
            if (queued) {
                state.queuedSuggestionKeys.push(groupKey);
                if (state.queuedSuggestionKeys.length > 200) {
                    state.queuedSuggestionKeys = state.queuedSuggestionKeys.slice(-100);
                }
                saveAttackLearningState(state, tid);
                outcome = 'suggestion_queued';
                Logger.info(`[instant-learning] Queued attack suggestion ${suggestion.rule.name} after ${windowBlocks.length} blocks (${groupKey})`);
                setImmediate(() => {
                    void import('./threat-research-pipeline.js').then(({ buildBlockRepeatEvent, enqueueThreatResearch }) => {
                        enqueueThreatResearch(buildBlockRepeatEvent(event.block_rule, event.toolName, event.block_reason, event.argsFingerprint, {
                            arguments: event.arguments,
                            argSnippets: event.argSnippets,
                            windowBlocks,
                        }));
                    });
                });
            }
        }
    }
    if (process.env.MASTYF_AI_AI_INSTANT_LLM === 'true') {
        void maybeRunInstantLlm(event, attackClassFromBlockRule(event.block_rule) || 'unknown').then((llm) => {
            if (llm.argPatterns?.length) {
                const slug = `${event.block_rule}-${event.toolName}`.replace(/[^a-z0-9-]+/gi, '-').slice(0, 40);
                queuePendingAttackSuggestion({
                    rule: {
                        name: `threat-lab-instant-${slug}`,
                        description: `Instant LLM argPatterns from ${event.block_rule}`,
                        action: 'block',
                        argPatterns: llm.argPatterns,
                    },
                    confidence: 0.82,
                    reason: `LLM-proposed argPatterns for repeated ${event.block_rule} blocks`,
                    source: 'attack',
                }, { source: 'threat-lab-instant', tenantId: tid });
            }
            if (llm.confidenceBoost > 0 && windowBlocks.length >= minBlocks) {
                const suggestion = suggestFromBlockedGroup(event.block_rule, event.toolName, toProxyRecords(windowBlocks));
                if (suggestion)
                    mergePendingSuggestion(suggestion, llm.confidenceBoost, tid, 'threat-lab-instant');
            }
        });
    }
    Metrics.instantLearningEventsTotal.inc({ block_rule: event.block_rule, outcome });
    StructuredLogger.info({
        event: 'instant_learning_event',
        serverName: event.serverName,
        toolName: event.toolName,
        block_rule: event.block_rule,
        argsFingerprint: event.argsFingerprint,
        windowCount: windowBlocks.length,
        queued,
        autoApply: isAiAutoApplyEnabled(),
    });
    return { queued, windowCount: windowBlocks.length };
}
/** @internal Test reset */
export function resetInstantAttackLearningState() {
    stateCacheByTenant = new Map();
    lastLlmInstantAt = 0;
    suggestionCounter = 0;
    sharedStore = null;
}
//# sourceMappingURL=instant-attack-learning.js.map