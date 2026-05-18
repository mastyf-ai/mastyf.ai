import { createHash } from 'crypto';
import type { PolicyDecisionRecord } from './data-collector.js';
import { recordPolicyDecisionGlobal } from './data-collector.js';
import { triggerLearningCycleIfEnabled } from './suggestion-engine.js';
import { recordInstantBlockEvent } from './instant-attack-learning.js';
import { isAiLearningEnabled } from '../utils/ai-enabled.js';
import { Logger } from '../utils/logger.js';
import type { HistoryDatabase } from '../database/history-db.js';
import type { McpServerConfig } from '../types.js';

export interface PolicyBlockContext {
  block_rule: string;
  toolName: string;
  serverName: string;
  argsFingerprint: string;
}

export interface BlockLearningEvent extends PolicyBlockContext {
  block_reason: string;
  argSnippets?: string[];
}

const DEFAULT_DEBOUNCE_MS = 30_000;

const SENSITIVE_ARG_KEYS = /password|secret|token|api[_-]?key|credential|private/i;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingContext: PolicyBlockContext | null = null;
let pendingDb: HistoryDatabase | undefined;
let pendingServers: McpServerConfig[] = [];

function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeysDeep(obj[key]);
  }
  return sorted;
}

/** Stable 16-char hex fingerprint of normalized tool arguments. */
export function fingerprintArgs(args: unknown): string {
  if (args === undefined || args === null) return '0000000000000000';
  try {
    const normalized = JSON.stringify(sortKeysDeep(args));
    return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  } catch {
    return createHash('sha256').update(String(args)).digest('hex').slice(0, 16);
  }
}

/** Redacted string snippets from tool args for instant learning (no secrets). */
export function redactArgSnippets(args: unknown, max = 5): string[] {
  if (args === null || args === undefined) return [];
  const snippets: string[] = [];

  const visit = (value: unknown, keyPath: string): void => {
    if (snippets.length >= max) return;
    if (typeof value === 'string') {
      if (SENSITIVE_ARG_KEYS.test(keyPath)) {
        snippets.push(`${keyPath}=[REDACTED]`);
      } else {
        snippets.push(`${keyPath}=${value.slice(0, 80)}`);
      }
      return;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      snippets.push(`${keyPath}=${String(value)}`);
      return;
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < Math.min(value.length, 3); i++) {
        visit(value[i], `${keyPath}[${i}]`);
      }
      return;
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const path = keyPath ? `${keyPath}.${k}` : k;
        if (SENSITIVE_ARG_KEYS.test(k)) {
          snippets.push(`${path}=[REDACTED]`);
        } else {
          visit(v, path);
        }
      }
    }
  };

  visit(args, '');
  return snippets.slice(0, max);
}

function debounceMs(): number {
  const n = parseInt(process.env.GUARDIAN_AI_BLOCK_DEBOUNCE_MS || String(DEFAULT_DEBOUNCE_MS), 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DEBOUNCE_MS;
}

/**
 * Per-block hook: immediate rolling stats + optional suggestion queue, then debounced full cycle.
 */
export function recordBlockLearningEvent(
  event: BlockLearningEvent,
  opts?: { db?: HistoryDatabase; servers?: McpServerConfig[] },
): void {
  if (isAiLearningEnabled()) {
    recordInstantBlockEvent(event);
  }
  onPolicyBlock(event, opts);
}

/**
 * Debounced hook after proxy blocks — batches burst blocks into one learning cycle.
 */
export function onPolicyBlock(
  context: PolicyBlockContext,
  opts?: { db?: HistoryDatabase; servers?: McpServerConfig[] },
): void {
  pendingContext = context;
  if (opts?.db) pendingDb = opts.db;
  if (opts?.servers?.length) pendingServers = opts.servers;

  if (!isAiLearningEnabled()) return;

  const ms = debounceMs();
  if (ms === 0) {
    void flushBlockLearning();
    return;
  }

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void flushBlockLearning();
  }, ms);
}

async function flushBlockLearning(): Promise<void> {
  const ctx = pendingContext;
  pendingContext = null;
  if (!ctx || !isAiLearningEnabled()) return;

  Logger.debug(
    `[block-learning] Triggering learning cycle after block rule=${ctx.block_rule} tool=${ctx.toolName} fp=${ctx.argsFingerprint}`,
  );

  await triggerLearningCycleIfEnabled(pendingDb, pendingServers);
}

/** Wire proxy policy evaluation into the in-memory collector. */
export function ingestPolicyDecision(decision: PolicyDecisionRecord): void {
  recordPolicyDecisionGlobal(decision);
}

/** Test helper — cancel pending debounce. */
export function resetBlockLearningDebounce(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  pendingContext = null;
}
