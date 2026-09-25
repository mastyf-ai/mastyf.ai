/**
 * Metrics for policy hot-reload failures (M-012).
 */
import { Counter, Gauge } from 'prom-client';
import { registry } from '../utils/metrics.js';
import { broadcastDashboardEvent } from '../utils/dashboard-events.js';
import { StructuredLogger } from '../utils/structured-logger.js';
export const policyLoadErrorsTotal = new Counter({
    name: 'mastyf_ai_policy_load_errors_total',
    help: 'Policy YAML load/validation failures during hot-reload',
    labelNames: ['reason'],
    registers: [registry],
});
export const policyLoadErrorGauge = new Gauge({
    name: 'mastyf_ai_policy_load_error',
    help: '1 when last policy reload failed validation (old policy retained)',
    labelNames: ['reason'],
    registers: [registry],
});
let lastReason = '';
export function recordPolicyLoadError(reason) {
    const trimmed = reason.slice(0, 120);
    lastReason = trimmed;
    policyLoadErrorsTotal.inc({ reason: trimmed });
    policyLoadErrorGauge.set({ reason: trimmed }, 1);
    StructuredLogger.warn({
        event: 'policy_load_error',
        reason: trimmed,
        behavior: 'retain_previous_policy',
    });
    broadcastDashboardEvent({
        type: 'logs:alert',
        payload: {
            severity: 'warn',
            code: 'policy_load_error',
            reason: trimmed,
            behavior: 'retain_previous_policy',
        },
        timestamp: Date.now(),
    });
}
export function clearPolicyLoadError() {
    if (lastReason) {
        policyLoadErrorGauge.set({ reason: lastReason }, 0);
        lastReason = '';
    }
}
/** @internal */
export function resetPolicyLoadMetricsForTests() {
    lastReason = '';
    policyLoadErrorGauge.reset();
}
//# sourceMappingURL=policy-load-metrics.js.map