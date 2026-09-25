import type { PolicyEngine } from '../policy/policy-engine.js';
/** Outcome returned to the transport layer after inspecting a tool response. */
export interface ResponseInspectionResult {
    blocked: boolean;
    redacted: boolean;
    /** If blocked, the JSON-RPC error body to return to the client. */
    blockResponse?: Record<string, unknown>;
    /** If redacted, the reasons that triggered redaction. */
    redactionReasons?: string[];
}
/**
 * Inspect a JSON-RPC tool-call response for policy violations, DLP
 * matches, and semantic threats.
 *
 * When the response is redacted the function **mutates** `response.result`
 * in place (all three transports rely on this behaviour).
 */
export declare function inspectToolResponse(params: {
    response: Record<string, unknown>;
    toolName: string;
    serverName: string;
    requestId: string | number;
    tenantId?: string;
    policyEngine: PolicyEngine | null | undefined;
    /** Label used in log lines, e.g. "http-proxy", "sse-proxy", "ws-proxy". */
    transportLabel: string;
    /** Original tools/call arguments (for live exploit tap). */
    toolArguments?: Record<string, unknown>;
}): Promise<ResponseInspectionResult>;
//# sourceMappingURL=response-inspection.d.ts.map