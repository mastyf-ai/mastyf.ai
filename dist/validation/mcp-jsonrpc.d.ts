import { z } from 'zod';
declare const JsonRpcMessageSchema: z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    method: z.ZodOptional<z.ZodString>;
    id: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodNull]>>;
    params: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    result: z.ZodOptional<z.ZodUnknown>;
    error: z.ZodOptional<z.ZodUnknown>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    jsonrpc: z.ZodLiteral<"2.0">;
    method: z.ZodOptional<z.ZodString>;
    id: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodNull]>>;
    params: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    result: z.ZodOptional<z.ZodUnknown>;
    error: z.ZodOptional<z.ZodUnknown>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    jsonrpc: z.ZodLiteral<"2.0">;
    method: z.ZodOptional<z.ZodString>;
    id: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodNull]>>;
    params: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    result: z.ZodOptional<z.ZodUnknown>;
    error: z.ZodOptional<z.ZodUnknown>;
}, z.ZodTypeAny, "passthrough">>;
export type McpJsonRpcValidationResult = {
    ok: true;
    msg: z.infer<typeof JsonRpcMessageSchema>;
} | {
    ok: false;
    code: number;
    message: string;
};
export declare function validateMcpJsonRpcMessage(msg: Record<string, unknown>): McpJsonRpcValidationResult;
export {};
//# sourceMappingURL=mcp-jsonrpc.d.ts.map