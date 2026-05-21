/**
 * Post-hoc LLM semantic audit — non-blocking queue for tools/call.
 * Sync path stays regex/semantic-guards only; LLM runs after JSON-RPC returns.
 */
import { Counter, Gauge } from 'prom-client';
import { LlmAssistant } from './llm-assistant.js';
import { Logger } from '../utils/logger.js';
import { StructuredLogger } from '../utils/structured-logger.js';
import { registry } from '../utils/metrics.js';
import { getGuardianRegionLabels } from '../utils/region.js';
import {
  isSemanticLlmConfigured,
  reportSemanticDegradation,
} from '../utils/semantic-layer.js';
import {
  isLocalSemanticEnabled,
  scoreLocalSemanticRisk,
} from './local-semantic-classifier.js';
import { withSemanticTimeout } from '../utils/semantic-timeout.js';
import type { CallContext, PolicyDecision } from '../policy/policy-types.js';

export interface SemanticAuditJob {
  requestId: string | number;
  serverName: string;
  toolName: string;
  arguments?: Record<string, unknown>;
  syncDecision: PolicyDecision;
  timestamp: string;
}

export interface SemanticAuditResult {
  suspicious: boolean;
  confidence: number;
  categories: string[];
  reasoning: string;
}

export interface SemanticAuditStats {
  queued: number;
  processed: number;
  flagged: number;
  dropped: number;
  enabled: boolean;
}

const DEBOUNCE_MS = parseInt(process.env.GUARDIAN_SEMANTIC_DEBOUNCE_MS || '500', 10);
const MAX_QUEUE = parseInt(process.env.GUARDIAN_SEMANTIC_ASYNC_MAX_QUEUE || '200', 10);
const MIN_CONFIDENCE = parseFloat(process.env.GUARDIAN_SEMANTIC_MIN_CONFIDENCE || '0.6');

const semanticAuditQueued = new Counter({
  name: 'mcp_guardian_semantic_audit_queued_total',
  help: 'Async semantic audit jobs enqueued',
  labelNames: ['region'],
  registers: [registry],
});

const semanticAuditProcessed = new Counter({
  name: 'mcp_guardian_semantic_audit_processed_total',
  help: 'Async semantic audit jobs completed',
  labelNames: ['region', 'outcome'],
  registers: [registry],
});

const semanticAuditQueueDepth = new Gauge({
  name: 'mcp_guardian_semantic_audit_queue_depth',
  help: 'Current async semantic audit queue depth',
  registers: [registry],
});

const queue: SemanticAuditJob[] = [];
let processing = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let llm: LlmAssistant | null = null;
let stats = { processed: 0, flagged: 0, dropped: 0 };

export function isSemanticAsyncEnabled(): boolean {
  if (process.env.GUARDIAN_SEMANTIC_ASYNC === 'false') return false;
  if (process.env.GUARDIAN_SEMANTIC_ASYNC === 'true') return true;
  return process.env.GUARDIAN_LLM_ENABLED !== 'false';
}

/** @internal test helper */
export function resetSemanticAuditStateForTests(): void {
  queue.length = 0;
  processing = false;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  llm = null;
  stats = { processed: 0, flagged: 0, dropped: 0 };
  semanticAuditQueueDepth.set(0);
}

export function getSemanticAuditStats(): SemanticAuditStats {
  return {
    queued: queue.length,
    processed: stats.processed,
    flagged: stats.flagged,
    dropped: stats.dropped,
    enabled: isSemanticAsyncEnabled(),
  };
}

function getLlm(): LlmAssistant {
  if (!llm) llm = new LlmAssistant();
  return llm;
}

/** Enqueue async semantic audit (debounced batch drain). Never blocks the caller. */
export function enqueueSemanticAudit(job: SemanticAuditJob): void {
  if (!isSemanticAsyncEnabled()) return;
  if (!getLlm().isAvailable() || !isSemanticLlmConfigured()) {
    if (isLocalSemanticEnabled()) {
      void runLocalSemanticAudit(job);
      return;
    }
    reportSemanticDegradation('llm_unavailable', {
      serverName: job.serverName,
      toolName: job.toolName,
    });
    return;
  }

  if (queue.length >= MAX_QUEUE) {
    queue.shift();
    stats.dropped++;
    semanticAuditProcessed.inc({ ...getGuardianRegionLabels(), outcome: 'dropped' });
    Logger.warn('[async-semantic] Queue at capacity — dropped oldest audit job');
  }

  queue.push(job);
  semanticAuditQueued.inc(getGuardianRegionLabels());
  semanticAuditQueueDepth.set(queue.length);

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void drainQueue();
  }, DEBOUNCE_MS);
}

async function drainQueue(): Promise<void> {
  if (processing || queue.length === 0) return;
  processing = true;
  const batch = queue.splice(0, queue.length);
  semanticAuditQueueDepth.set(queue.length);
  try {
    for (const job of batch) {
      await runAudit(job);
    }
  } finally {
    processing = false;
    if (queue.length > 0) {
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void drainQueue();
      }, DEBOUNCE_MS);
    }
  }
}

async function runLocalSemanticAudit(job: SemanticAuditJob): Promise<void> {
  const score = scoreLocalSemanticRisk({
    serverName: job.serverName,
    toolName: job.toolName,
    arguments: job.arguments,
    syncRule: job.syncDecision.rule,
  });
  stats.processed++;
  if (!score.suspicious) {
    semanticAuditProcessed.inc({ ...getGuardianRegionLabels(), outcome: 'local_clean' });
    return;
  }
  const minRisk = parseFloat(process.env['GUARDIAN_LOCAL_SEMANTIC_MIN_RISK'] || '0.55');
  if (score.risk < minRisk) {
    semanticAuditProcessed.inc({ ...getGuardianRegionLabels(), outcome: 'local_below_threshold' });
    return;
  }
  stats.flagged++;
  semanticAuditProcessed.inc({ ...getGuardianRegionLabels(), outcome: 'local_flagged' });
  StructuredLogger.info({
    event: 'local_semantic_flag',
    requestId: job.requestId,
    serverName: job.serverName,
    toolName: job.toolName,
    syncDecision: job.syncDecision,
    risk: score.risk,
    categories: score.categories,
    reasoning: score.reasoning,
    timestamp: job.timestamp,
    region: getGuardianRegionLabels().region,
  });
}

async function runAudit(job: SemanticAuditJob): Promise<void> {
  const argsPreview = JSON.stringify(job.arguments ?? {}).slice(0, 2000);
  const systemPrompt = `You are an MCP security analyst. Classify whether a tools/call is suspicious AFTER sync policy passed.
Respond ONLY with JSON: {"suspicious":boolean,"confidence":0-1,"categories":string[],"reasoning":"one sentence"}
Categories: prompt-injection, exfiltration, privilege-escalation, encoded-payload, none.`;

  const userPrompt =
    `Server: ${job.serverName}\nTool: ${job.toolName}\nSync decision: ${job.syncDecision.action} (${job.syncDecision.rule})\nArguments: ${argsPreview}`;

  const response = await withSemanticTimeout(
    'async_semantic_audit',
    () => getLlm().generate(systemPrompt, userPrompt),
    null,
  );
  stats.processed++;
  if (!response) {
    semanticAuditProcessed.inc({ ...getGuardianRegionLabels(), outcome: 'no_llm' });
    return;
  }

  let result: SemanticAuditResult;
  try {
    const parsed = JSON.parse(response.text) as Partial<SemanticAuditResult>;
    result = {
      suspicious: Boolean(parsed.suspicious),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      reasoning: String(parsed.reasoning || ''),
    };
  } catch {
    semanticAuditProcessed.inc({ ...getGuardianRegionLabels(), outcome: 'parse_error' });
    Logger.debug('[async-semantic] Failed to parse LLM JSON');
    return;
  }

  if (!result.suspicious || result.confidence < MIN_CONFIDENCE) {
    semanticAuditProcessed.inc({ ...getGuardianRegionLabels(), outcome: 'clean' });
    return;
  }

  stats.flagged++;
  semanticAuditProcessed.inc({ ...getGuardianRegionLabels(), outcome: 'flagged' });

  const auditPayload = {
    event: 'async_semantic_flag' as const,
    requestId: job.requestId,
    serverName: job.serverName,
    toolName: job.toolName,
    syncDecision: job.syncDecision,
    semanticAudit: result,
    model: response.model,
    durationMs: response.durationMs,
    timestamp: job.timestamp,
    region: getGuardianRegionLabels().region,
  };

  StructuredLogger.info(auditPayload);
}

/** Build job from proxy context after sync policy evaluation. */
export function buildSemanticAuditJob(
  ctx: CallContext,
  syncDecision: PolicyDecision,
): SemanticAuditJob {
  return {
    requestId: ctx.requestId ?? 'unknown',
    serverName: ctx.serverName,
    toolName: ctx.toolName,
    arguments: ctx.arguments,
    syncDecision,
    timestamp: ctx.timestamp ?? new Date().toISOString(),
  };
}
