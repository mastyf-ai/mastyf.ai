/**
 * Per-block instant attack learning — sync stats + optional lightweight suggestions.
 * Complements debounced full learning cycles in block-learning.ts.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import type { ProxyCallRecord } from '../types.js';
import {
  attackGroupKey,
  attackMinBlocks,
  suggestFromBlockedGroup,
  type AttackPatternSuggestion,
} from './attack-pattern-learner.js';
import { resolveAttackLearningStatePath, resolveAiPendingSuggestionsPath } from './ai-paths.js';
import { LlmAssistant } from './llm-assistant.js';
import { isAiAutoApplyEnabled, isAiLearningEnabled } from '../utils/ai-enabled.js';
import { Logger } from '../utils/logger.js';
import { StructuredLogger } from '../utils/structured-logger.js';
import * as Metrics from '../utils/metrics.js';
import { broadcastDashboardEvent } from '../utils/dashboard-events.js';
import { resolveTenantId, DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';
import { getInstantLlmTimeoutMs, withSemanticTimeout } from '../utils/semantic-timeout.js';

export interface InstantBlockEvent {
  serverName: string;
  toolName: string;
  block_rule: string;
  block_reason: string;
  argsFingerprint: string;
  argSnippets?: string[];
  tenantId?: string;
}

interface RecentBlock {
  ts: number;
  serverName: string;
  toolName: string;
  blockRule: string;
  blockReason: string;
  argsFingerprint: string;
}

interface RuleToolStats {
  count: number;
  lastAt: string;
  reasons: string[];
}

export interface AttackLearningState {
  version: 1;
  updatedAt: string;
  totalEvents: number;
  ruleToolCounts: Record<string, RuleToolStats>;
  reasonNgrams: Record<string, number>;
  recentBlocks: RecentBlock[];
  queuedSuggestionKeys: string[];
  knownClassConfidence: Record<string, number>;
}

const CRITICAL_RULES = new Set([
  'semantic-shell-guard',
  'secret-scan',
  'path-guard',
  'sensitive-path',
]);

const RULE_TO_ATTACK_CLASS: Record<string, string> = {
  'secret-scan': 'secret_exfil',
  'path-guard': 'path_traversal',
  'sensitive-path': 'path_traversal',
  'semantic-shell-guard': 'prompt_injection',
  'sql-exfil': 'sql_injection',
  'arg-entropy': 'obfuscation',
};

let stateCacheByTenant = new Map<string, AttackLearningState>();
let lastLlmInstantAt = 0;
let suggestionCounter = 0;
/** PostgreSQL-backed store (AuditTrailSync); falls back to local JSON file when unset. */
let sharedStore: {
  getAttackLearningState?: (tenantId: string) => Promise<AttackLearningState | null>;
  persistAttackLearningState?: (state: AttackLearningState, tenantId: string) => Promise<void>;
} | null = null;

export function setAttackLearningSharedStore(store: typeof sharedStore): void {
  sharedStore = store;
}

function attackLearningTenantId(explicit?: string): string {
  return explicit || resolveTenantId();
}

function getTenantStateCache(tenantId: string): AttackLearningState | undefined {
  return stateCacheByTenant.get(tenantId);
}

function setTenantStateCache(tenantId: string, state: AttackLearningState): void {
  stateCacheByTenant.set(tenantId, state);
}

function instantLearningEnabled(): boolean {
  if (process.env.GUARDIAN_AI_INSTANT_LEARNING === 'false') return false;
  return isAiLearningEnabled();
}

function instantLlmEnabled(): boolean {
  return process.env.GUARDIAN_AI_INSTANT_LLM === 'true' && instantLearningEnabled();
}

function windowMs(): number {
  const n = parseInt(process.env.GUARDIAN_AI_INSTANT_WINDOW_MS || '300000', 10);
  return Number.isFinite(n) && n > 0 ? n : 300_000;
}

function llmRateLimitMs(): number {
  const n = parseInt(process.env.GUARDIAN_AI_INSTANT_LLM_RATE_MS || '60000', 10);
  return Number.isFinite(n) && n > 0 ? n : 60_000;
}

function emptyState(): AttackLearningState {
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

export function loadAttackLearningState(tenantId?: string): AttackLearningState {
  const tid = attackLearningTenantId(tenantId);
  const cached = getTenantStateCache(tid);
  if (cached) return cached;
  const path = resolveAttackLearningStatePath(tid);
  if (!existsSync(path)) {
    const empty = emptyState();
    setTenantStateCache(tid, empty);
    return empty;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as AttackLearningState;
    const state = { ...emptyState(), ...parsed, version: 1 as const };
    setTenantStateCache(tid, state);
    return state;
  } catch {
    const empty = emptyState();
    setTenantStateCache(tid, empty);
    return empty;
  }
}

/** Load from PostgreSQL shared store (call at bootstrap when GUARDIAN_AUDIT_SYNC_ENABLED). */
export async function loadAttackLearningFromSharedStore(tenantId?: string): Promise<void> {
  if (!sharedStore?.getAttackLearningState) return;
  const tid = attackLearningTenantId(tenantId);
  try {
    const remote = await sharedStore.getAttackLearningState(tid);
    if (!remote) return;
    const local = loadAttackLearningState(tid);
    const remoteTs = Date.parse(remote.updatedAt || '0');
    const localTs = Date.parse(local.updatedAt || '0');
    if (remoteTs >= localTs) {
      const merged = { ...emptyState(), ...remote, version: 1 as const };
      setTenantStateCache(tid, merged);
      saveAttackLearningState(merged, tid);
    }
    Logger.info(`[instant-learning] Loaded attack learning state from shared PostgreSQL store (tenant=${tid})`);
  } catch (err: unknown) {
    Logger.warn(
      `[instant-learning] Shared store load failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function saveAttackLearningState(state: AttackLearningState, tenantId?: string): void {
  state.updatedAt = new Date().toISOString();
  const tid = attackLearningTenantId(tenantId);
  setTenantStateCache(tid, state);
  if (sharedStore?.persistAttackLearningState) {
    try {
      const p = sharedStore.persistAttackLearningState(state, tid);
      if (p && typeof (p as Promise<void>).catch === 'function') {
        void (p as Promise<void>).catch((err: unknown) => {
          Logger.debug(
            `[instant-learning] Shared PG persist failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }
    } catch (err: unknown) {
      Logger.debug(
        `[instant-learning] Shared PG persist failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  try {
    const path = resolveAttackLearningStatePath(tid);
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(state, null, 2));
  } catch (err: unknown) {
    Logger.debug(
      `[instant-learning] Failed to persist state: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Extract 2–3 word n-grams from block reasons for rolling pattern stats. */
export function extractReasonNgrams(reason: string): string[] {
  const tokens = reason
    .toLowerCase()
    .replace(/[^a-z0-9./_-]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  const ngrams: string[] = [];
  for (let n = 2; n <= 3; n++) {
    for (let i = 0; i <= tokens.length - n; i++) {
      ngrams.push(tokens.slice(i, i + n).join(' '));
    }
  }
  return ngrams;
}

function pruneWindow(state: AttackLearningState, now: number): void {
  const cutoff = now - windowMs();
  state.recentBlocks = state.recentBlocks.filter((b) => b.ts >= cutoff);
}

function blocksInWindow(state: AttackLearningState, blockRule: string, toolName: string): RecentBlock[] {
  return state.recentBlocks.filter((b) => b.blockRule === blockRule && b.toolName === toolName);
}

function toProxyRecords(blocks: RecentBlock[]): ProxyCallRecord[] {
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

function mergePendingSuggestion(
  suggestion: AttackPatternSuggestion,
  confidenceBoost = 0,
  tenantId?: string,
): boolean {
  const path = resolveAiPendingSuggestionsPath(tenantId);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let pending: {
    updatedAt: string;
    suggestions: Array<{
      id: string;
      ruleName: string;
      rule: AttackPatternSuggestion['rule'];
      confidence: number;
      reason: string;
      source: string;
    }>;
  } = { updatedAt: new Date().toISOString(), suggestions: [] };

  if (existsSync(path)) {
    try {
      pending = JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
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
    source: 'attack',
  });
  pending.updatedAt = new Date().toISOString();
  try {
    writeFileSync(path, JSON.stringify(pending, null, 2));
  } catch (err: unknown) {
    Logger.debug(
      `[instant-learning] Failed to queue suggestion: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  broadcastDashboardEvent({
    type: 'ai:suggestions',
    payload: { suggestions: pending.suggestions, instant: true },
    timestamp: Date.now(),
  });
  return true;
}

async function maybeRunInstantLlm(
  event: InstantBlockEvent,
  attackClass: string,
): Promise<number> {
  if (!instantLlmEnabled() || !CRITICAL_RULES.has(event.block_rule)) return 0;
  const now = Date.now();
  if (now - lastLlmInstantAt < llmRateLimitMs()) return 0;
  lastLlmInstantAt = now;

  const tid = attackLearningTenantId(event.tenantId);
  const assistant = new LlmAssistant();
  const systemPrompt =
    'Classify MCP tool-call blocks. Reply ONLY JSON: {"attackClass":"...","confidence":0.0-1.0}';
  const userPrompt = JSON.stringify({
    block_rule: event.block_rule,
    tool: event.toolName,
    reason: event.block_reason.slice(0, 500),
    snippets: event.argSnippets?.slice(0, 3),
  });

  const result = await withSemanticTimeout(
    'instant-attack-llm',
    () => assistant.generate(systemPrompt, userPrompt),
    null,
    getInstantLlmTimeoutMs(),
  );
  if (!result?.text) return 0;

  try {
    const parsed = JSON.parse(result.text) as { attackClass?: string; confidence?: number };
    const cls = parsed.attackClass || attackClass;
    const conf = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;
    const state = loadAttackLearningState(tid);
    state.knownClassConfidence[cls] = Math.max(state.knownClassConfidence[cls] || 0, conf);
    saveAttackLearningState(state, tid);
    return conf > 0.7 ? 0.05 : 0;
  } catch {
    Logger.debug('[instant-learning] LLM classifier returned non-JSON');
    return 0;
  }
}

function bumpKnownClassConfidence(state: AttackLearningState, blockRule: string): number {
  const cls = RULE_TO_ATTACK_CLASS[blockRule];
  if (!cls) return 0;
  const prev = state.knownClassConfidence[cls] || 0.4;
  const next = Math.min(prev + 0.06, 0.95);
  state.knownClassConfidence[cls] = next;
  return next - prev;
}

/**
 * Synchronous per-block learning: rolling stats, state file, optional instant suggestion queue.
 */
export function recordInstantBlockEvent(event: InstantBlockEvent): {
  queued: boolean;
  windowCount: number;
} {
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
    if (stats.reasons.length > 20) stats.reasons = stats.reasons.slice(-20);
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
    const suggestion = suggestFromBlockedGroup(
      event.block_rule,
      event.toolName,
      toProxyRecords(windowBlocks),
    );
    if (suggestion) {
      queued = mergePendingSuggestion(suggestion, confidenceBoost, tid);
      if (queued) {
        state.queuedSuggestionKeys.push(groupKey);
        if (state.queuedSuggestionKeys.length > 200) {
          state.queuedSuggestionKeys = state.queuedSuggestionKeys.slice(-100);
        }
        saveAttackLearningState(state, tid);
        outcome = 'suggestion_queued';
        Logger.info(
          `[instant-learning] Queued attack suggestion ${suggestion.rule.name} after ${windowBlocks.length} blocks (${groupKey})`,
        );
      }
    }
  }

  if (process.env.GUARDIAN_AI_INSTANT_LLM === 'true') {
    void maybeRunInstantLlm(event, RULE_TO_ATTACK_CLASS[event.block_rule] || 'unknown').then((llmBoost) => {
      if (llmBoost > 0 && windowBlocks.length >= minBlocks) {
        const suggestion = suggestFromBlockedGroup(
          event.block_rule,
          event.toolName,
          toProxyRecords(windowBlocks),
        );
        if (suggestion) mergePendingSuggestion(suggestion, llmBoost);
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
export function resetInstantAttackLearningState(): void {
  stateCacheByTenant = new Map();
  lastLlmInstantAt = 0;
  suggestionCounter = 0;
  sharedStore = null;
}
