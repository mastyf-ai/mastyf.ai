/**
 * Post-hoc LLM semantic audit — non-blocking queue for tools/call.
 * Sync path stays regex/semantic-guards only; LLM runs after JSON-RPC returns.
 */
import { Counter, Gauge } from 'prom-client';
import { LlmAssistant } from './llm-assistant.js';
import { getLlmCache, semanticToLlmCacheKey } from './llm-cache.js';
import { getLlmConfig } from '../config/llm-config.js';
import { Logger } from '../utils/logger.js';
import { StructuredLogger } from '../utils/structured-logger.js';
import { registry } from '../utils/metrics.js';
import * as Metrics from '../utils/metrics.js';
import { getMastyfAiRegionLabels } from '../utils/region.js';
import {
  isSemanticLlmConfigured,
  reportSemanticDegradation,
} from '../utils/semantic-layer.js';
import {
  isLocalSemanticEnabled,
  scoreLocalSemanticRisk,
} from './local-semantic-classifier.js';
import { isSemanticAsyncEnabledForTenant } from '../tenant/tenant-semantic-config.js';
import { withSemanticTimeout } from '../utils/semantic-timeout.js';
import {
  isSemanticCircuitOpen,
  tryBeginSemanticLlmProbe,
  recordSemanticLlmFailure,
  recordSemanticLlmSuccess,
} from './semantic-circuit-breaker.js';
import {
  allowSemanticLlmCall,
  reportSemanticAuditSkipped,
} from './semantic-llm-rate-limit.js';
import { broadcastDashboardEvent, emitFlowStep } from '../utils/dashboard-events.js';
import type { CallContext, PolicyDecision } from '../policy/policy-types.js';
import { routeSemanticModelForTenant } from './tenant-semantic-model.js';

export interface SemanticAuditJob {
  requestId: string | number;
  serverName: string;
  toolName: string;
  arguments?: Record<string, unknown>;
  syncDecision: PolicyDecision;
  timestamp: string;
  tenantId?: string;
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

const DEBOUNCE_MS = parseInt(process.env.MASTYF_AI_SEMANTIC_DEBOUNCE_MS || '500', 10);
const MAX_QUEUE = parseInt(process.env.MASTYF_AI_SEMANTIC_ASYNC_MAX_QUEUE || '200', 10);
const MIN_CONFIDENCE = parseFloat(process.env.MASTYF_AI_SEMANTIC_MIN_CONFIDENCE || '0.6');

const semanticAuditQueued = new Counter({
  name: 'mastyf_ai_semantic_audit_queued_total',
  help: 'Async semantic audit jobs enqueued',
  labelNames: ['region'],
  registers: [registry],
});

const semanticAuditProcessed = new Counter({
  name: 'mastyf_ai_semantic_audit_processed_total',
  help: 'Async semantic audit jobs completed',
  labelNames: ['region', 'outcome'],
  registers: [registry],
});

const semanticAuditQueueDepth = new Gauge({
  name: 'mastyf_ai_semantic_audit_queue_depth',
  help: 'Current async semantic audit queue depth',
  registers: [registry],
});

const queue: SemanticAuditJob[] = [];
let processing = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

let llmByModel = new Map<string, LlmAssistant>();
let stats = { processed: 0, flagged: 0, dropped: 0 };

export function isSemanticAsyncEnabled(tenantId?: string): boolean {
  return isSemanticAsyncEnabledForTenant(tenantId);
}

/** @internal test helper */
export function resetSemanticAuditStateForTests(): void {
  queue.length = 0;
  processing = false;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  llmByModel.clear();
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

function shouldStoreCalibrationRecord(): boolean {
  return process.env.MASTYF_AI_SEMANTIC_STORE_CALIBRATION === 'true';
}

async function persistSemanticAudit(
  job: SemanticAuditJob,
  result: SemanticAuditResult,
  meta?: { model?: string; durationMs?: number },
): Promise<import('./semantic-audit-store.js').StoredSemanticAudit | null> {
  try {
    const { appendSemanticAuditRecord } = await import('./semantic-audit-store.js');
    return appendSemanticAuditRecord({
      requestId: job.requestId,
      serverName: job.serverName,
      toolName: job.toolName,
      syncDecision: job.syncDecision,
      semanticAudit: result,
      model: meta?.model,
      durationMs: meta?.durationMs,
      timestamp: job.timestamp,
      argumentsSnapshot: (await import('../utils/audit-args-snapshot.js')).snapshotAuditArguments(job.arguments),
    });
  } catch (err) {
    Logger.debug(
      `[async-semantic] Failed to persist audit record: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/** Wait for debounced async semantic queue (used by swarm live scenario before proxy exit). */
export async function flushSemanticAuditQueue(maxWaitMs = 15000): Promise<SemanticAuditStats> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
      await drainQueue();
    } else if (!processing && queue.length === 0) {
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return getSemanticAuditStats();
}

function getLlm(tenantId?: string): LlmAssistant {
  const routing = routeSemanticModelForTenant(tenantId);
  const modelKey = routing.model || getLlmConfig().model;
  const cached = llmByModel.get(modelKey);
  if (cached) return cached;
  const assistant = new LlmAssistant(routing.model ? { model: routing.model } : undefined);
  llmByModel.set(modelKey, assistant);
  return assistant;
}

/** Enqueue async semantic audit (debounced batch drain). Never blocks the caller. */
export function enqueueSemanticAudit(job: SemanticAuditJob): void {
  void reserveAndEnqueue(job);
}

async function reserveAndEnqueue(job: SemanticAuditJob): Promise<void> {
  if (!isSemanticAsyncEnabled(job.tenantId)) return;

  if (!getLlm(job.tenantId).isAvailable() || !isSemanticLlmConfigured()) {
    if (isLocalSemanticEnabled(job.tenantId)) {
      void runLocalSemanticAudit(job);
      return;
    }
    reportSemanticAuditSkipped('no_api_key', job.tenantId);
    reportSemanticDegradation('llm_unavailable', {
      serverName: job.serverName,
      toolName: job.toolName,
    });
    return;
  }

  if (isSemanticCircuitOpen(job.tenantId)) {
    reportSemanticAuditSkipped('circuit_open', job.tenantId);
    if (isLocalSemanticEnabled(job.tenantId)) {
      void runLocalSemanticAudit(job);
    }
    return;
  }

  if (queue.length >= MAX_QUEUE) {
    queue.shift();
    stats.dropped++;
    semanticAuditProcessed.inc({ ...getMastyfAiRegionLabels(), outcome: 'dropped' });
    Logger.warn('[async-semantic] Queue at capacity — dropped oldest audit job');
  }

  queue.push(job);
  semanticAuditQueued.inc(getMastyfAiRegionLabels());
  semanticAuditQueueDepth.set(queue.length);

  broadcastDashboardEvent({
    type: 'semantic:queued',
    serverName: job.serverName,
    payload: {
      requestId: job.requestId,
      toolName: job.toolName,
      syncRule: job.syncDecision.rule,
    },
    timestamp: Date.now(),
  });
  emitFlowStep({
    kind: 'semantic_queued',
    title: `Semantic audit queued: ${job.toolName}`,
    summary: `Async review after ${job.syncDecision.action} (${job.syncDecision.rule})`,
    severity: 'info',
    serverName: job.serverName,
    toolName: job.toolName,
    requestId: String(job.requestId),
  });

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
    tenantId: job.tenantId,
  });
  stats.processed++;
  if (!score.suspicious) {
    semanticAuditProcessed.inc({ ...getMastyfAiRegionLabels(), outcome: 'local_clean' });
    return;
  }
  const minRisk = parseFloat(process.env['MASTYF_AI_LOCAL_SEMANTIC_MIN_RISK'] || '0.55');
  if (score.risk < minRisk) {
    semanticAuditProcessed.inc({ ...getMastyfAiRegionLabels(), outcome: 'local_below_threshold' });
    return;
  }
  stats.flagged++;
  semanticAuditProcessed.inc({ ...getMastyfAiRegionLabels(), outcome: 'local_flagged' });
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
    region: getMastyfAiRegionLabels().region,
  });
  const result = {
    suspicious: true,
    confidence: score.risk,
    categories: score.categories,
    reasoning: score.reasoning,
  };
  if (score.risk >= MIN_CONFIDENCE || shouldStoreCalibrationRecord()) {
    await persistSemanticAudit(job, result, { model: 'local-semantic' }).then((stored) => {
      if (!stored || score.risk < MIN_CONFIDENCE) return;
      setImmediate(() => {
        void import('./threat-research-pipeline.js').then(({ buildSemanticFlagEvent, enqueueThreatResearch }) => {
          enqueueThreatResearch(buildSemanticFlagEvent(stored));
        });
      });
    });
  }
  broadcastSemanticComplete(job, result);
}

async function runAudit(job: SemanticAuditJob): Promise<void> {
  const allowed = await allowSemanticLlmCall(job.tenantId);
  if (!allowed) {
    reportSemanticAuditSkipped('rate_limited', job.tenantId);
    if (isLocalSemanticEnabled(job.tenantId)) {
      await runLocalSemanticAudit(job);
    }
    return;
  }

  if (!tryBeginSemanticLlmProbe(job.tenantId)) {
    reportSemanticAuditSkipped('circuit_open', job.tenantId);
    if (isLocalSemanticEnabled(job.tenantId)) {
      await runLocalSemanticAudit(job);
    }
    return;
  }

  const argsPreview = JSON.stringify(job.arguments ?? {}).slice(0, 2000);
  const systemPrompt = `You are an MCP security analyst. Classify whether a tools/call is suspicious AFTER sync policy passed.
Respond ONLY with JSON: {"suspicious":boolean,"confidence":0-1,"categories":string[],"reasoning":"one sentence"}
Categories: prompt-injection, exfiltration, privilege-escalation, encoded-payload, none.`;

  const userPrompt =
    `Server: ${job.serverName}\nTool: ${job.toolName}\nSync decision: ${job.syncDecision.action} (${job.syncDecision.rule})\nArguments: ${argsPreview}`;

  const llmCfg = getLlmConfig();
  const cache = getLlmCache();
  const cacheKey = semanticToLlmCacheKey(
    {
      model: llmCfg.model,
      serverName: job.serverName,
      toolName: job.toolName,
      arguments: job.arguments,
      temperature: llmCfg.temperature,
      tenantId: job.tenantId,
      policyMode: job.syncDecision.action,
    },
    systemPrompt,
    userPrompt,
  );
  const cachedText = await cache.get(cacheKey);
  let response: Awaited<ReturnType<LlmAssistant['generate']>> = null;
  if (cachedText) {
    response = {
      text: cachedText,
      model: llmCfg.model,
      tokensUsed: 0,
      durationMs: 0,
    };
    recordSemanticLlmSuccess(job.tenantId);
  } else {
    const auditStart = Date.now();
    try {
      response = await withSemanticTimeout(
        'async_semantic_audit',
        () => getLlm(job.tenantId).generate(systemPrompt, userPrompt),
        null,
      );
      Metrics.recordSemanticScanDuration(
        'async_audit',
        Date.now() - auditStart,
        response?.text ? 'ok' : 'no_llm',
      );
      if (response?.text) {
        recordSemanticLlmSuccess(job.tenantId);
        await cache.set(cacheKey, response.text);
      } else {
        recordSemanticLlmFailure(undefined, job.tenantId);
      }
    } catch (err) {
      Metrics.recordSemanticScanDuration('async_audit', Date.now() - auditStart, 'error');
      recordSemanticLlmFailure(err, job.tenantId);
      response = null;
    }
  }
  stats.processed++;
  if (!response) {
    semanticAuditProcessed.inc({ ...getMastyfAiRegionLabels(), outcome: 'no_llm' });
    reportSemanticAuditSkipped('llm_failed', job.tenantId);
    if (isLocalSemanticEnabled(job.tenantId)) {
      await runLocalSemanticAudit(job);
    }
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
    semanticAuditProcessed.inc({ ...getMastyfAiRegionLabels(), outcome: 'parse_error' });
    Logger.debug('[async-semantic] Failed to parse LLM JSON');
    return;
  }

  const flagged = result.suspicious && result.confidence >= MIN_CONFIDENCE;
  if (!flagged) {
    semanticAuditProcessed.inc({ ...getMastyfAiRegionLabels(), outcome: 'clean' });
    if (shouldStoreCalibrationRecord()) {
      await persistSemanticAudit(job, result, {
        model: response.model,
        durationMs: response.durationMs,
      });
    }
    return;
  }

  stats.flagged++;
  semanticAuditProcessed.inc({ ...getMastyfAiRegionLabels(), outcome: 'flagged' });

  StructuredLogger.info({
    event: 'async_semantic_flag' as const,
    requestId: job.requestId,
    serverName: job.serverName,
    toolName: job.toolName,
    syncDecision: job.syncDecision,
    semanticAudit: result,
    model: response.model,
    durationMs: response.durationMs,
    timestamp: job.timestamp,
    region: getMastyfAiRegionLabels().region,
  });

  await persistSemanticAudit(job, result, {
    model: response.model,
    durationMs: response.durationMs,
  }).then((stored) => {
    if (!stored) return;
    setImmediate(() => {
      void import('./threat-research-pipeline.js').then(({ buildSemanticFlagEvent, enqueueThreatResearch }) => {
        enqueueThreatResearch(buildSemanticFlagEvent(stored));
      });
      if (result.suspicious) {
        void import('../alerting/soar-playbooks.js').then(({ runSoarPlaybooks }) =>
          runSoarPlaybooks({
            event: 'semantic_flag',
            toolName: job.toolName,
            serverName: job.serverName,
            confidence: result.confidence,
            categories: result.categories,
            requestId: job.requestId,
            id: stored.id,
          }),
        );
      }
    });
  });
  broadcastSemanticComplete(job, result);
}

function broadcastSemanticComplete(
  job: SemanticAuditJob,
  result: { suspicious: boolean; confidence: number; categories: string[]; reasoning: string },
): void {
  broadcastDashboardEvent({
    type: 'semantic:complete',
    serverName: job.serverName,
    payload: {
      requestId: job.requestId,
      toolName: job.toolName,
      suspicious: result.suspicious,
      confidence: result.confidence,
      categories: result.categories,
    },
    timestamp: Date.now(),
  });
  emitFlowStep({
    kind: 'semantic_complete',
    title: result.suspicious
      ? `Semantic flag: ${job.toolName}`
      : `Semantic clear: ${job.toolName}`,
    summary: result.reasoning || result.categories.join(', ') || 'No categories',
    severity: result.suspicious ? 'warn' : 'success',
    serverName: job.serverName,
    toolName: job.toolName,
    requestId: String(job.requestId),
    metadata: { confidence: result.confidence, categories: result.categories },
  });
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
    tenantId: ctx.tenantId,
  };
}
