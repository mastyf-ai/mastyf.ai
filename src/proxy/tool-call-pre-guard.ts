/**
 * Shared pre-forward guards for tools/call across all proxy transports.
 */
import {
  agenticPreForwardToolCall,
  buildAgenticToolCallContext,
  type AgenticToolCallContext,
} from './agentic-hooks-bridge.js';
import { checkExpandedPayload } from './payload-guard.js';
import { hasJsonRpcId, jsonRpcErrorBody } from './json-rpc-utils.js';
import type { IncomingHttpHeaders } from 'http';

export type ToolCallPreGuardResult =
  | { blocked: false; arguments?: Record<string, unknown> }
  | { blocked: true; code: number; message: string };

export async function runToolCallPreForwardGuard(
  serverName: string,
  toolName: string,
  args: Record<string, unknown> | undefined,
  requestId: string,
  opts?: {
    agentId?: string;
    mcpSessionId?: string;
    meta?: Record<string, unknown>;
    headers?: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
  },
): Promise<ToolCallPreGuardResult> {
  if (args !== undefined) {
    const expanded = checkExpandedPayload(args);
    if (!expanded.ok) {
      return {
        blocked: true,
        code: -32001,
        message: `Blocked by MCP Guardian: ${expanded.reason}`,
      };
    }
  }
  if (args) {
    const ctx: AgenticToolCallContext = buildAgenticToolCallContext({
      requestId,
      agentId: opts?.agentId,
      mcpSessionId: opts?.mcpSessionId,
      meta: opts?.meta ?? (args._meta as Record<string, unknown> | undefined),
      headers: opts?.headers,
    });
    const agentic = await agenticPreForwardToolCall(serverName, toolName, args, ctx);
    if (agentic.blocked) {
      return {
        blocked: true,
        code: -32001,
        message: `Blocked by MCP Guardian: ${agentic.reason || 'agentic policy'}`,
      };
    }
    return { blocked: false, arguments: agentic.sanitizedArgs ?? args };
  }
  return { blocked: false };
}

/** JSON-RPC error object for transports that return Record responses. */
export function toolCallGuardBlockResponse(
  id: unknown,
  guard: Extract<ToolCallPreGuardResult, { blocked: true }>,
): Record<string, unknown> {
  if (!hasJsonRpcId(id)) {
    return { jsonrpc: '2.0', error: { code: guard.code, message: guard.message } };
  }
  return jsonRpcErrorBody(id, guard.code, guard.message) as Record<string, unknown>;
}
