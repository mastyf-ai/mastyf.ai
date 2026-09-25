import * as Metrics from './metrics.js';
import { isRedisConfigured, getSharedRedisClient } from './redis-client.js';
import { isSemanticLlmConfigured } from './semantic-layer.js';
import { getSemanticAuditStats } from '../ai/async-semantic-audit.js';
import { isAppAlertingConfigured } from '../alerting/alert-env.js';
import { isTracingEnabled, isTracingInitialized } from './tracing.js';
let llmProbeOnline = true;
/** Updated by semantic LLM health probes and incident-responder trackLlmHealth. */
export function setLlmProbeOnline(online) {
    llmProbeOnline = online;
}
export async function probeRedisAvailable() {
    if (!isRedisConfigured())
        return false;
    try {
        const client = getSharedRedisClient();
        const pong = await client.ping();
        return pong === 'PONG';
    }
    catch {
        return false;
    }
}
/** Refresh Prometheus gauges referenced by enterprise PrometheusRule alerts. */
export async function refreshObservabilityGauges() {
    const redisOk = await probeRedisAvailable();
    Metrics.redisAvailable.set(redisOk ? 1 : 0);
    const semanticOnline = isSemanticLlmConfigured() && llmProbeOnline;
    Metrics.semanticLlmOnline.set(semanticOnline ? 1 : 0);
    const auditDepth = getSemanticAuditStats().queued;
    Metrics.auditQueueDepth.set(auditDepth);
    Metrics.alertingConfigured.set(isAppAlertingConfigured() ? 1 : 0);
    Metrics.tracingConfigured.set(isTracingEnabled() && isTracingInitialized() ? 1 : 0);
}
//# sourceMappingURL=observability-gauges.js.map