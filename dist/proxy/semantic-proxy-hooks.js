/**
 * Shared semantic strict pre-check, sync gate, and async audit enqueue for all proxy transports.
 *
 * Transport parity (M-007): stdio, HTTP, SSE, and streamable HTTP proxies all call
 * `runPostPolicyAllowGates` → `runSemanticPipelineAfterPolicyAllow` from this module.
 */
import { buildSemanticAuditJob, enqueueSemanticAudit, isSemanticAsyncEnabled } from '../ai/async-semantic-audit.js';
import { reportSemanticAuditSkipped } from '../ai/semantic-llm-rate-limit.js';
import { isSemanticLlmConfigured, isSemanticStrictMode, reportSemanticDegradation, } from '../utils/semantic-layer.js';
import { runSyncSemanticRequestGate } from './proxy-post-policy-gates.js';
export function checkSemanticStrictPrecheck(context, serverName) {
    if (!isSemanticAsyncEnabled(context.tenantId) || isSemanticLlmConfigured()) {
        return null;
    }
    reportSemanticAuditSkipped('no_api_key', context.tenantId);
    reportSemanticDegradation('llm_unavailable', {
        serverName,
        toolName: context.toolName,
    });
    if (!isSemanticStrictMode(context.tenantId)) {
        return null;
    }
    return {
        block: true,
        rule: 'semantic-degraded',
        reason: 'Semantic LLM layer unavailable (MASTYF_AI_SEMANTIC_STRICT=true)',
        metricCategory: 'semantic_sync_request',
    };
}
/** Run strict pre-check, sync semantic gate, then enqueue async audit. Returns block info or null. */
export async function runSemanticPipelineAfterPolicyAllow(context, decision, serverName) {
    const strict = checkSemanticStrictPrecheck(context, serverName);
    if (strict)
        return strict;
    const semGate = await runSyncSemanticRequestGate(context, decision, serverName);
    if (semGate.block)
        return semGate;
    enqueueSemanticAudit(buildSemanticAuditJob(context, decision));
    return null;
}
//# sourceMappingURL=semantic-proxy-hooks.js.map