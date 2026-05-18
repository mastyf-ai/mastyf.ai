/**
 * Semantic LLM layer availability, degradation reporting, and strict mode.
 *
 * GUARDIAN_SEMANTIC_STRICT=true — block tools/call when async semantic audit cannot run
 * (no API key / LLM disabled). Mirrors GUARDIAN_STRICT_MODE patterns in enterprise-bootstrap.
 */
import { getLlmConfig } from '../config/llm-config.js';
import { StructuredLogger } from './structured-logger.js';
import { broadcastDashboardEvent } from './dashboard-events.js';

const loggedReasons = new Set<string>();

export function isSemanticLlmConfigured(): boolean {
  const cfg = getLlmConfig();
  if (!cfg.enabled) return false;
  if (cfg.provider === 'anthropic') return Boolean(cfg.anthropicApiKey);
  if (cfg.provider === 'openai') return Boolean(cfg.openaiApiKey);
  return true;
}

export function isSemanticStrictMode(): boolean {
  return process.env.GUARDIAN_SEMANTIC_STRICT === 'true';
}

/** Structured log + dashboard alert (deduped per reason per process). */
export function reportSemanticDegradation(
  reason: string,
  context?: Record<string, unknown>,
): void {
  if (!loggedReasons.has(reason)) {
    loggedReasons.add(reason);
    StructuredLogger.warn({
      event: 'semantic_layer_degraded',
      reason,
      strict: isSemanticStrictMode(),
      ...context,
    });
    broadcastDashboardEvent({
      type: 'logs:alert',
      payload: {
        severity: 'warn',
        code: 'semantic_layer_degraded',
        reason,
        strict: isSemanticStrictMode(),
        ...context,
      },
      timestamp: Date.now(),
    });
  }
}

/** @internal */
export function resetSemanticDegradationLogForTests(): void {
  loggedReasons.clear();
}
