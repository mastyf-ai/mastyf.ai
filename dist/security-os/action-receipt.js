/**
 * Portable Action Receipt shape (OS5/OS6).
 * Aligns with schemas/action-receipt.schema.json.
 * Middleware (LangChain / OpenAI Agents) and MCP proxy emit the same contract.
 * SIEM/GRC may consume; Mastyf remains authority.
 */
import { createHash } from 'crypto';
import { z } from 'zod';
export const ACTION_RECEIPT_SCHEMA_VERSION = 1;
export const ACTION_RECEIPT_SCHEMA_PATH = 'schemas/action-receipt.schema.json';
export const ActionReceiptSchema = z.object({
    schema: z.literal(ACTION_RECEIPT_SCHEMA_VERSION),
    kind: z.literal('mastyf_action_receipt'),
    receipt_id: z.string().min(1),
    timestamp_utc: z.string().min(1),
    transport: z.enum(['mcp', 'langchain', 'openai-agents', 'other']),
    principal: z.object({
        principal_id: z.string().min(1),
        client_id: z.string().optional(),
        tenant_id: z.string().optional(),
        scopes: z.array(z.string()).optional(),
    }),
    tool: z.object({
        name: z.string().min(1),
        server_id: z.string().optional(),
        server_name: z.string().optional(),
    }),
    capabilities: z.array(z.string()),
    data_labels: z.array(z.string()),
    decision: z.enum(['ALLOW', 'BLOCK', 'ESCALATE', 'FLAG', 'AUDIT']),
    execution: z.enum(['RESPONSE_RECEIVED', 'SENT_CHILD_NO_RESPONSE', 'NOT_SENT', 'UNKNOWN']),
    bytes_sent: z.number().int().min(0),
    policy_hash: z.string().nullable(),
    arguments_hash: z.string().nullable(),
    reason_code: z.string().optional(),
    receipt_hash: z.string().min(1),
    /** Optional OTel join — never authority; mirrors middleware packages. */
    trace_id: z.string().optional(),
    command_digest: z.string().optional(),
});
function canonicalForHash(receipt) {
    return JSON.stringify(receipt, Object.keys(receipt).sort());
}
export function computeActionReceiptHash(receipt) {
    return createHash('sha256').update(canonicalForHash(receipt)).digest('hex');
}
export function buildActionReceipt(input) {
    const base = {
        schema: ACTION_RECEIPT_SCHEMA_VERSION,
        kind: 'mastyf_action_receipt',
        receipt_id: input.receipt_id,
        timestamp_utc: input.timestamp_utc,
        transport: input.transport,
        principal: input.principal,
        tool: input.tool,
        capabilities: input.capabilities ?? [],
        data_labels: input.data_labels ?? [],
        decision: input.decision,
        execution: input.execution,
        bytes_sent: input.bytes_sent,
        policy_hash: input.policy_hash,
        arguments_hash: input.arguments_hash,
        reason_code: input.reason_code,
        ...(input.trace_id ? { trace_id: input.trace_id } : {}),
        ...(input.command_digest ? { command_digest: input.command_digest } : {}),
    };
    const receipt_hash = input.receipt_hash ?? computeActionReceiptHash(base);
    return ActionReceiptSchema.parse({ ...base, receipt_hash });
}
export function parseActionReceipt(raw) {
    return ActionReceiptSchema.parse(raw);
}
export function hashArguments(args) {
    const obj = (args && typeof args === 'object' ? args : {});
    const canonical = JSON.stringify(args ?? {}, Object.keys(obj).sort());
    return createHash('sha256').update(canonical).digest('hex');
}
//# sourceMappingURL=action-receipt.js.map