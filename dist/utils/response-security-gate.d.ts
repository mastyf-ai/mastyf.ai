/**
 * Unified response security gate: DLP + optional sync semantic block/redact.
 */
import { type StreamingInspectResult } from './streaming-inspector.js';
import type { PolicyEngine } from '../policy/policy-engine.js';
export type ResponseGateOutcome = {
    action: 'forward';
} | {
    action: 'redact';
    body: string;
    redactionReasons?: string[];
} | {
    action: 'block';
    message: string;
    rule: string;
};
export interface ResponseGateResult {
    outcome: ResponseGateOutcome;
    inspect: StreamingInspectResult | null;
}
export declare function gateToolResponseText(opts: {
    responseText: string;
    toolName: string;
    serverName: string;
    policy: PolicyEngine | null | undefined;
    requestId?: string | number;
    tenantId?: string;
}): Promise<ResponseGateResult>;
//# sourceMappingURL=response-security-gate.d.ts.map