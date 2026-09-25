/**
 * Transport-agnostic Action Receipt adapters for middleware.
 * Prefer importing from here when wiring LangChain / OpenAI Agents.
 */
import { ACTION_RECEIPT_SCHEMA_VERSION, ActionReceiptSchema, buildActionReceipt, parseActionReceipt, computeActionReceiptHash, hashArguments, } from '../security-os/action-receipt.js';
export { ACTION_RECEIPT_SCHEMA_VERSION, ActionReceiptSchema, buildActionReceipt, parseActionReceipt, computeActionReceiptHash, hashArguments, };
export function decisionFromEval(evaluation, mode = 'block') {
    if (mode === 'audit')
        return 'AUDIT';
    if (!evaluation.allowed)
        return 'BLOCK';
    if (evaluation.action === 'flag')
        return 'FLAG';
    if (evaluation.action === 'block')
        return 'BLOCK';
    return 'ALLOW';
}
export function emitMiddlewareActionReceipt(params) {
    const decision = decisionFromEval(params.evaluation, params.mode);
    const blocked = decision === 'BLOCK';
    return buildActionReceipt({
        receipt_id: params.receiptId,
        timestamp_utc: new Date().toISOString(),
        transport: params.transport,
        principal: {
            principal_id: params.principalId,
            client_id: params.clientId,
            tenant_id: params.tenantId,
        },
        tool: { name: params.toolName },
        capabilities: [],
        data_labels: [],
        decision,
        execution: blocked ? 'NOT_SENT' : 'UNKNOWN',
        bytes_sent: 0,
        policy_hash: params.policyHash ?? null,
        arguments_hash: hashArguments(params.args),
        reason_code: params.evaluation.rule || params.evaluation.reason || undefined,
    });
}
//# sourceMappingURL=action-receipt.js.map