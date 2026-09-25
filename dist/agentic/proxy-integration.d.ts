/**
 * Proxy Integration Hooks — wire agentic features into the proxy pipeline.
 *
 * Import and call these functions from proxy-server.ts at `tools/call` time
 * to enable behavior observation and prompt injection detection.
 *
 * Usage in proxy-server.ts (add after policy evaluation, before forwarding):
 *
 *   import { hookAgenticObservation, hookPromptInjectionCheck } from '../agentic/proxy-integration.js';
 *   await hookAgenticObservation(container, serverName, toolName, args, sessionKey, latencyMs, success);
 *   await hookPromptInjectionCheck(container, serverName, toolName, args);
 */
import type { Container } from '../container.js';
import { type GlobalSessionInput } from '../utils/global-session-id.js';
export type AgenticToolCallContext = GlobalSessionInput;
/**
 * Hook: Record a tool call observation for policy generation.
 * Call this on every tools/call that passes through the proxy.
 */
export declare function hookAgenticObservation(container: Container, serverName: string, toolName: string, args: Record<string, unknown>, sessionHash: string, _latencyMs: number, _success: boolean, agentId?: string, credentialIdentity?: string): Promise<void>;
/**
 * Hook: Run prompt injection detection on tool call arguments.
 * Call this before forwarding the tool call to the downstream server.
 *
 * Returns sanitized arguments if injection was detected and sanitization was applied.
 */
export declare function hookPromptInjectionCheck(container: Container, serverName: string, toolName: string, args: Record<string, unknown>): Promise<{
    blocked: boolean;
    sanitizedArgs?: Record<string, unknown>;
    reason?: string;
}>;
/**
 * Hook: Submit blocked attack patterns to the threat intelligence mesh.
 * Call this when a policy rule blocks a tool call.
 */
export declare function hookThreatMeshContribution(container: Container, blockedPattern: string, category: string, severity?: 'critical' | 'high' | 'medium' | 'low'): void;
export interface AgenticAuditParams {
    sessionId: string;
    method: string;
    toolName?: string;
    args?: Record<string, unknown>;
    latencyMs: number;
    blocked: boolean;
    blockReason?: string;
    responseSize?: number;
    statusCode?: string;
    userId?: string;
}
/** Record an MCP request in the agentic audit trail. */
export declare function recordAgenticAudit(container: Container, params: AgenticAuditParams): void;
/** Pre-forward hooks: sandbox tier, intent binding, collusion, reputation, injection scan. */
export declare function runAgenticPreForwardHooks(container: Container, serverName: string, toolName: string, args: Record<string, unknown>, sessionCtx: AgenticToolCallContext | string, legacyAgentId?: string): Promise<{
    blocked: boolean;
    sanitizedArgs?: Record<string, unknown>;
    reason?: string;
}>;
/** Post-response hooks: finalize observation metrics + digital twin capture (A2). */
export declare function runAgenticPostCallHooks(container: Container, serverName: string, toolName: string, args: Record<string, unknown>, sessionHash: string, latencyMs: number, success: boolean, agentId?: string, responseSize?: number): Promise<void>;
/** Denied call: audit + optional threat mesh contribution. */
export declare function runAgenticDeniedCallHooks(container: Container, params: AgenticAuditParams & {
    blockRule?: string;
}): void;
//# sourceMappingURL=proxy-integration.d.ts.map