import { evaluateSyncSemanticRequest } from '../ai/sync-semantic-request.js';
import * as Metrics from '../utils/metrics.js';
import { decideViaGateway, isGatewayArbiterEnabled, } from '../gateway-ledger/gateway-arbiter-client.js';
import { emitMastyfDecision, mastyfAttrsFromDecide, } from '../utils/dashboard-telemetry.js';
import { getTraceLogFields } from '../utils/tracing.js';
export async function runGatewayArbiterGate(context, serverName) {
    if (!isGatewayArbiterEnabled()) {
        return { block: false };
    }
    const result = await decideViaGateway({
        toolName: context.toolName || 'unknown',
        toolArgs: context.arguments || {},
        userIntent: `Execute tool ${context.toolName}`,
        sessionId: `${context.tenantId || 'default'}:${serverName}`,
        serverName,
        serverId: serverName,
        tenantId: context.tenantId,
        requestId: String(context.requestId),
    });
    const tid = getTraceLogFields().trace_id;
    emitMastyfDecision({
        ...mastyfAttrsFromDecide({
            finalDecision: result.finalDecision,
            cbacDecision: result.cbacDecision,
            difcDecision: result.difcDecision,
            workflowDecision: result.workflowDecision,
            aiaDecision: result.aiaDecision,
            arbiterDecision: result.finalDecision,
            execution: result.executionObservation || (result.executionPermitted ? 'PERMITTED' : 'NOT_SENT'),
            bytesSent: result.bytesSent ?? (result.executionPermitted ? undefined : 0),
            receiptId: result.receiptId || String(context.requestId || ''),
            policyHash: result.policyHash,
            raw: result.raw,
        }),
        'mastyf.server_id': serverName,
        'mastyf.principal_id': String(context.tenantId || 'default'),
        ...(tid ? { 'mastyf.trace_id': tid } : {}),
    });
    if (result.finalDecision === 'ALLOW' && result.executionPermitted) {
        return { block: false };
    }
    Metrics.recordProxyBlock({
        server_name: serverName,
        block_reason: result.finalDecision === 'ESCALATE' ? 'gateway_escalate' : 'gateway_block',
        rule: result.reasonCode,
        tenant_id: context.tenantId,
    }, 'semantic');
    return {
        block: true,
        rule: result.reasonCode,
        reason: result.finalDecision === 'ESCALATE'
            ? `Needs human review (gateway): ${result.reasonCode}${result.error ? ` (${result.error})` : ''}`
            : `Blocked by Mastyf gateway: ${result.reasonCode}`,
        metricCategory: 'gateway_arbiter',
        escalate: result.finalDecision === 'ESCALATE',
        cbacDecision: result.cbacDecision,
        difcDecision: result.difcDecision,
        aiaDecision: result.aiaDecision,
    };
}
export async function runSyncSemanticRequestGate(context, decision, serverName) {
    // Authoritative path first
    const arbiter = await runGatewayArbiterGate(context, serverName);
    if (arbiter.block)
        return arbiter;
    const semReq = await evaluateSyncSemanticRequest({ context, policyDecision: decision });
    if (!semReq.block) {
        return { block: false };
    }
    Metrics.semanticSyncRequestBlocksTotal.inc(Metrics.withTenantMetricLabels({ server_name: serverName }, context.tenantId));
    Metrics.recordProxyBlock({
        server_name: serverName,
        block_reason: 'semantic_sync_request',
        rule: semReq.rule,
        tenant_id: context.tenantId,
    }, 'semantic');
    return {
        block: true,
        rule: semReq.rule,
        reason: semReq.reason,
        metricCategory: 'semantic_sync_request',
    };
}
//# sourceMappingURL=proxy-post-policy-gates.js.map