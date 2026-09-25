import { z } from 'zod';
const ALLOWED_PROTOCOL_VERSIONS = new Set(['2024-11-05', '2025-03-26']);
const JsonRpcMessageSchema = z.object({
    jsonrpc: z.literal('2.0'),
    method: z.string().min(1).optional(),
    id: z.union([z.string(), z.number(), z.null()]).optional(),
    params: z.record(z.unknown()).optional(),
    result: z.unknown().optional(),
    error: z.unknown().optional(),
}).passthrough();
export function validateMcpJsonRpcMessage(msg) {
    const parsed = JsonRpcMessageSchema.safeParse(msg);
    if (!parsed.success) {
        return {
            ok: false,
            code: -32600,
            message: 'Invalid JSON-RPC 2.0 request',
        };
    }
    const method = parsed.data.method;
    if (!method) {
        return { ok: true, msg: parsed.data };
    }
    if (method === 'initialize') {
        const params = parsed.data.params;
        const version = typeof params?.protocolVersion === 'string' ? params.protocolVersion : '';
        if (!ALLOWED_PROTOCOL_VERSIONS.has(version)) {
            return {
                ok: false,
                code: -32602,
                message: `Unsupported or missing MCP protocolVersion (allowed: ${[...ALLOWED_PROTOCOL_VERSIONS].join(', ')})`,
            };
        }
    }
    if (method === 'tools/call') {
        const params = parsed.data.params;
        if (typeof params?.name !== 'string' || !params.name.trim()) {
            return {
                ok: false,
                code: -32602,
                message: 'tools/call requires params.name (string)',
            };
        }
        if (params.arguments !== undefined && (typeof params.arguments !== 'object' || params.arguments === null || Array.isArray(params.arguments))) {
            return {
                ok: false,
                code: -32602,
                message: 'tools/call params.arguments must be an object when present',
            };
        }
    }
    return { ok: true, msg: parsed.data };
}
//# sourceMappingURL=mcp-jsonrpc.js.map