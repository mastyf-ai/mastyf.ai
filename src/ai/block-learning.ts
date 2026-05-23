import { createHash } from 'crypto';
import type { PolicyDecisionRecord } from './data-collector.js';
import { recordPolicyDecisionGlobal } from './data-collector.js';
import { triggerLearningCycleIfEnabled } from './suggestion-engine.js';
import { recordInstantBlockEvent } from './instant-attack-learning.js';
import { isAiLearningEnabled } from '../utils/ai-enabled.js';
import { getLicenseClient } from '../license/license-client.js';
import { isCiLicenseBypass } from '../license/feature-tiers.js';
import { isCiTokenCached } from '../license/ci-token.js';
import { Logger } from '../utils/logger.js';
import type { HistoryDatabase } from '../database/history-db.js';
import type { McpServerConfig } from '../types.js';
import { isRedisConfigured, getSharedRedisClient } from '../utils/redis-client.js';
import { tenantRateLimitKey } from '../tenant/resolve-tenant.js';

export interface PolicyBlockContext {
  block_rule: string;
  toolName: string;
  serverName: string;
  argsFingerprint: string;
}

export interface BlockLearningEvent extends PolicyBlockContext {
  block_reason: string;
  argSnippets?: string[];
  /** Redacted tool arguments for LLM threat research (no secrets). */
  arguments?: Record<string, unknown>;
  tenantId?: string;
}

const DEFAULT_DEBOUNCE_MS = 30_000;

const SENSITIVE_ARG_KEYS = /password|secret|token|api[_-]?key|credential|private/i;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingContext: PolicyBlockContext | null = null;
let pendingTenantId: string | undefined;
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

/** Redacted tool arguments object for LLM threat research (no secrets). */
export function redactArguments(args: unknown, maxStringLen = 200): Record<string, unknown> | undefined {
  if (args === null || args === undefined) return undefined;
  if (typeof args !== 'object') return { value: String(args).slice(0, maxStringLen) };

  const redactValue = (value: unknown, keyPath: string): unknown => {
    if (SENSITIVE_ARG_KEYS.test(keyPath)) return '[REDACTED]';
    if (typeof value === 'string') return value.slice(0, maxStringLen);
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
    if (Array.isArray(value)) {
      return value.slice(0, 5).map((item, i) => redactValue(item, `${keyPath}[${i}]`));
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = redactValue(v, keyPath ? `${keyPath}.${k}` : k);
      }
      return out;
    }
    return String(value).slice(0, maxStringLen);
  };

  return redactValue(args, '') as Record<string, unknown>;
}

function debounceMs(): number {
  const n = parseInt(process.env.GUARDIAN_AI_BLOCK_DEBOUNCE_MS || String(DEFAULT_DEBOUNCE_MS), 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DEBOUNCE_MS;
}

/** Pro feature `ai` — instant + debounced learning loops (Community keeps regex/schema block). */
function aiLearningLicensed(): boolean {
  if (isCiLicenseBypass() || isCiTokenCached()) return true;
  return getLicenseClient().hasFeature('ai');
}

/**
 * Per-block hook: immediate rolling stats + optional suggestion queue, then debounced full cycle.
 */
export function recordBlockLearningEvent(
  event: BlockLearningEvent,
  opts?: { db?: HistoryDatabase; servers?: McpServerConfig[] },
): void {
  if (isAiLearningEnabled() && aiLearningLicensed()) {
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
  pendingTenantId = (context as BlockLearningEvent).tenantId;
  if (opts?.db) pendingDb = opts.db;
  if (opts?.servers?.length) pendingServers = opts.servers;

  if (!isAiLearningEnabled() || !aiLearningLicensed()) return;

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

function blockLearningLockTtlMs(): number {
  const n = parseInt(process.env.GUARDIAN_AI_BLOCK_DEBOUNCE_MS || String(DEFAULT_DEBOUNCE_MS), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DEBOUNCE_MS;
}

async function acquireBlockLearningLock(tenantId: string): Promise<boolean> {
  if (!isRedisConfigured()) return true;
  const key = tenantRateLimitKey(tenantId || 'default', 'block-learning:lock');
  try {
    const redis = getSharedRedisClient();
    const ok = await redis.set(key, '1', 'PX', blockLearningLockTtlMs(), 'NX');
    return ok === 'OK';
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Logger.warn(`[block-learning] Redis lock unavailable, proceeding locally: ${message}`);
    return true;
  }
}

async function flushBlockLearning(): Promise<void> {
  const ctx = pendingContext;
  pendingContext = null;
  if (!ctx || !isAiLearningEnabled() || !aiLearningLicensed()) return;

  const lockTenant = pendingTenantId || process.env['GUARDIAN_TENANT_ID'] || 'default';
  pendingTenantId = undefined;
  if (!(await acquireBlockLearningLock(lockTenant))) {
    Logger.debug(`[block-learning] Skipping cycle — another pod holds lock (tenant=${lockTenant})`);
    return;
  }

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
  pendingTenantId = undefined;
}
