/**
 * Semantic LLM layer availability, degradation reporting, and strict mode.
 *
 * MASTYF_AI_SEMANTIC_STRICT=true — block tools/call when async semantic audit cannot run
 * (no API key / LLM disabled). Mirrors MASTYF_AI_STRICT_MODE patterns in enterprise-bootstrap.
 */
import { getLlmConfig } from '../config/llm-config.js';
import { isSemanticStrictForTenant } from '../tenant/tenant-semantic-config.js';
import { reportSemanticAuditSkipped } from '../ai/semantic-llm-rate-limit.js';
import { StructuredLogger } from './structured-logger.js';
import { broadcastDashboardEvent } from './dashboard-events.js';
const loggedReasons = new Set();
export function isSemanticLlmConfigured() {
    const cfg = getLlmConfig();
    if (!cfg.enabled)
        return false;
    if (cfg.provider === 'anthropic')
        return Boolean(cfg.anthropicApiKey);
    if (cfg.provider === 'openai')
        return Boolean(cfg.openaiApiKey);
    return true;
}
export function isSemanticStrictMode(tenantId) {
    return isSemanticStrictForTenant(tenantId);
}
/** Structured log + dashboard alert (deduped per reason per process). */
function skipReasonFromDegradation(reason) {
    if (/unavailable|timeout|failed/i.test(reason))
        return 'llm_failed';
    if (/api_key|not configured|disabled/i.test(reason))
        return 'no_api_key';
    return 'license';
}
export function reportSemanticDegradation(reason, context) {
    const tenantId = typeof context?.tenantId === 'string' ? context.tenantId : undefined;
    reportSemanticAuditSkipped(skipReasonFromDegradation(reason), tenantId);
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
export function resetSemanticDegradationLogForTests() {
    loggedReasons.clear();
}
//# sourceMappingURL=semantic-layer.js.map