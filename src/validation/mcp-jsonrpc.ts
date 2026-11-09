import { z } from 'zod';

// MCP versions are dates. The upstream negotiates; the proxy only insists the value is well formed,
// so a new protocol release can't lock every current agent out.
const PROTOCOL_VERSION_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

const JsonRpcMessageSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string().min(1).optional(),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  params: z.record(z.unknown()).optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
}).passthrough();

export type McpJsonRpcValidationResult =
  | { ok: true; msg: z.infer<typeof JsonRpcMessageSchema> }
  | { ok: false; code: number; message: string };

export function validateMcpJsonRpcMessage(
  msg: Record<string, unknown>,
): McpJsonRpcValidationResult {
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
    const params = parsed.data.params as { protocolVersion?: unknown } | undefined;
    const version = typeof params?.protocolVersion === 'string' ? params.protocolVersion : '';
    if (!PROTOCOL_VERSION_FORMAT.test(version)) {
      return {
        ok: false,
        code: -32602,
        message: 'Unsupported or missing MCP protocolVersion (expected YYYY-MM-DD)',
      };
    }
  }

  if (method === 'tools/call') {
    const params = parsed.data.params as { name?: unknown; arguments?: unknown } | undefined;
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
