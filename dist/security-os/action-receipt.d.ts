import { z } from 'zod';
export declare const ACTION_RECEIPT_SCHEMA_VERSION: 1;
export declare const ACTION_RECEIPT_SCHEMA_PATH = "schemas/action-receipt.schema.json";
export declare const ActionReceiptSchema: z.ZodObject<{
    schema: z.ZodLiteral<1>;
    kind: z.ZodLiteral<"mastyf_action_receipt">;
    receipt_id: z.ZodString;
    timestamp_utc: z.ZodString;
    transport: z.ZodEnum<["mcp", "langchain", "openai-agents", "other"]>;
    principal: z.ZodObject<{
        principal_id: z.ZodString;
        client_id: z.ZodOptional<z.ZodString>;
        tenant_id: z.ZodOptional<z.ZodString>;
        scopes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        principal_id: string;
        tenant_id?: string | undefined;
        client_id?: string | undefined;
        scopes?: string[] | undefined;
    }, {
        principal_id: string;
        tenant_id?: string | undefined;
        client_id?: string | undefined;
        scopes?: string[] | undefined;
    }>;
    tool: z.ZodObject<{
        name: z.ZodString;
        server_id: z.ZodOptional<z.ZodString>;
        server_name: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        server_name?: string | undefined;
        server_id?: string | undefined;
    }, {
        name: string;
        server_name?: string | undefined;
        server_id?: string | undefined;
    }>;
    capabilities: z.ZodArray<z.ZodString, "many">;
    data_labels: z.ZodArray<z.ZodString, "many">;
    decision: z.ZodEnum<["ALLOW", "BLOCK", "ESCALATE", "FLAG", "AUDIT"]>;
    execution: z.ZodEnum<["RESPONSE_RECEIVED", "SENT_CHILD_NO_RESPONSE", "NOT_SENT", "UNKNOWN"]>;
    bytes_sent: z.ZodNumber;
    policy_hash: z.ZodNullable<z.ZodString>;
    arguments_hash: z.ZodNullable<z.ZodString>;
    reason_code: z.ZodOptional<z.ZodString>;
    receipt_hash: z.ZodString;
    /** Optional OTel join — never authority; mirrors middleware packages. */
    trace_id: z.ZodOptional<z.ZodString>;
    command_digest: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    transport: "mcp" | "other" | "langchain" | "openai-agents";
    kind: "mastyf_action_receipt";
    decision: "ALLOW" | "BLOCK" | "ESCALATE" | "FLAG" | "AUDIT";
    tool: {
        name: string;
        server_name?: string | undefined;
        server_id?: string | undefined;
    };
    schema: 1;
    bytes_sent: number;
    receipt_id: string;
    policy_hash: string | null;
    receipt_hash: string;
    timestamp_utc: string;
    arguments_hash: string | null;
    capabilities: string[];
    execution: "NOT_SENT" | "RESPONSE_RECEIVED" | "SENT_CHILD_NO_RESPONSE" | "UNKNOWN";
    principal: {
        principal_id: string;
        tenant_id?: string | undefined;
        client_id?: string | undefined;
        scopes?: string[] | undefined;
    };
    data_labels: string[];
    reason_code?: string | undefined;
    command_digest?: string | undefined;
    trace_id?: string | undefined;
}, {
    transport: "mcp" | "other" | "langchain" | "openai-agents";
    kind: "mastyf_action_receipt";
    decision: "ALLOW" | "BLOCK" | "ESCALATE" | "FLAG" | "AUDIT";
    tool: {
        name: string;
        server_name?: string | undefined;
        server_id?: string | undefined;
    };
    schema: 1;
    bytes_sent: number;
    receipt_id: string;
    policy_hash: string | null;
    receipt_hash: string;
    timestamp_utc: string;
    arguments_hash: string | null;
    capabilities: string[];
    execution: "NOT_SENT" | "RESPONSE_RECEIVED" | "SENT_CHILD_NO_RESPONSE" | "UNKNOWN";
    principal: {
        principal_id: string;
        tenant_id?: string | undefined;
        client_id?: string | undefined;
        scopes?: string[] | undefined;
    };
    data_labels: string[];
    reason_code?: string | undefined;
    command_digest?: string | undefined;
    trace_id?: string | undefined;
}>;
export type ActionReceipt = z.infer<typeof ActionReceiptSchema>;
export type ActionReceiptInput = Omit<ActionReceipt, 'schema' | 'kind' | 'receipt_hash'> & {
    receipt_hash?: string;
    capabilities?: string[];
    data_labels?: string[];
    trace_id?: string;
    command_digest?: string;
};
export declare function computeActionReceiptHash(receipt: Omit<ActionReceipt, 'receipt_hash'>): string;
export declare function buildActionReceipt(input: ActionReceiptInput): ActionReceipt;
export declare function parseActionReceipt(raw: unknown): ActionReceipt;
export declare function hashArguments(args: unknown): string;
//# sourceMappingURL=action-receipt.d.ts.map