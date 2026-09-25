/**
 * Transport-agnostic Action Receipt adapters for middleware.
 * Prefer importing from here when wiring LangChain / OpenAI Agents.
 */
import { ACTION_RECEIPT_SCHEMA_VERSION, ActionReceiptSchema, buildActionReceipt, parseActionReceipt, computeActionReceiptHash, hashArguments, type ActionReceipt, type ActionReceiptInput } from '../security-os/action-receipt.js';
export { ACTION_RECEIPT_SCHEMA_VERSION, ActionReceiptSchema, buildActionReceipt, parseActionReceipt, computeActionReceiptHash, hashArguments, type ActionReceipt, type ActionReceiptInput, };
export type MiddlewareTransport = 'langchain' | 'openai-agents' | 'other';
export interface MiddlewareEvalForReceipt {
    allowed: boolean;
    action: string;
    reason?: string;
    rule?: string;
}
export declare function decisionFromEval(evaluation: MiddlewareEvalForReceipt, mode?: 'audit' | 'warn' | 'block'): ActionReceipt['decision'];
export declare function emitMiddlewareActionReceipt(params: {
    transport: MiddlewareTransport;
    receiptId: string;
    toolName: string;
    args: Record<string, unknown>;
    principalId: string;
    clientId?: string;
    tenantId?: string;
    evaluation: MiddlewareEvalForReceipt;
    mode?: 'audit' | 'warn' | 'block';
    policyHash?: string | null;
}): ActionReceipt;
//# sourceMappingURL=action-receipt.d.ts.map