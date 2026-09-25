/**
 * ToolCallDefenseOrchestrator — unified Defense Fabric pipeline for all transports.
 *
 * Phases: lifecycle → pre-guard → policy → post-policy (spend + semantic).
 */
import type { IncomingHttpHeaders } from 'http';
import type { PolicyEngine } from '../policy/policy-engine.js';
import type { CallContext, PolicyDecision } from '../policy/policy-types.js';
import type { IDatabase } from '../database/database-interface.js';
import type { AgentIdentity } from '../auth/auth-types.js';
import { type ToolCallPreGuardResult } from './tool-call-pre-guard.js';
import { type PostPolicyAllowGateOutcome } from './proxy-post-allow-gates.js';
import type { ToolFingerprintState } from './tool-fingerprint.js';
import { ToolCallHookRegistry } from '../policy/tool-call-hooks.js';
export interface ToolCallDefenseInput {
    serverName: string;
    toolName: string;
    arguments?: Record<string, unknown>;
    requestId: string;
    requestTokens: number;
    tenantId: string;
    timestamp?: string;
    agentIdentity?: AgentIdentity;
    headers?: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
    meta?: Record<string, unknown>;
    mcpSessionId?: string;
    agentId?: string;
    idempotencyKey?: string;
}
export type ToolCallDefenseBlocked = {
    allowed: false;
    phase: 'lifecycle' | 'pre-guard' | 'hooks' | 'policy' | 'semantic' | 'spend';
    code: number;
    rule: string;
    reason: string;
    httpStatus?: number;
    preGuard?: Extract<ToolCallPreGuardResult, {
        blocked: true;
    }>;
};
export type ToolCallDefenseAllowed = {
    allowed: true;
    arguments: Record<string, unknown> | undefined;
    context: CallContext;
    decision: PolicyDecision;
    spendReservationId?: string;
    gateOutcome: PostPolicyAllowGateOutcome | null;
};
export type ToolCallDefenseResult = ToolCallDefenseBlocked | ToolCallDefenseAllowed;
export interface ToolCallDefenseDeps {
    policyEngine: PolicyEngine;
    db?: IDatabase;
    rugPullState?: ToolFingerprintState;
    /** When set, replaces policyEngine.evaluateAsync (e.g. pinned policy eval on stdio). */
    evaluatePolicy?: (context: CallContext) => Promise<PolicyDecision>;
    /** When false, skip notifyToolBlock / metrics (caller handles). Default true. */
    emitBlockTelemetry?: boolean;
    /** Hook registry for pre/post tool-call hooks. */
    hookRegistry?: ToolCallHookRegistry;
}
export declare const globalHookRegistry: ToolCallHookRegistry;
export declare function evaluateToolCallDefense(input: ToolCallDefenseInput, deps: ToolCallDefenseDeps): Promise<ToolCallDefenseResult>;
//# sourceMappingURL=tool-call-defense-orchestrator.d.ts.map