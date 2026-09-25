/**
 * C3 — Zero-Trust Continuous Verification Engine (per-call composite score).
 */
import type { BehaviorFingerprintEngine } from '../biometrics/behavior-fingerprint.js';
import type { ReputationEngine } from '../agent-reputation/reputation-engine.js';
import type { IntentEngine } from '../intent-binding/intent-engine.js';
import type { MCPCertifier } from '../certification/certifier.js';
import type { ApprovalGate } from '../core.js';
export interface VerificationContext {
    agentId: string;
    sessionId: string;
    serverName: string;
    toolName: string;
    authenticated: boolean;
    declaredIntent?: string;
    geoRegion?: string;
    hourUtc?: number;
    dataSensitivity?: 'low' | 'medium' | 'high';
    /** SPIFFE ID from workload API / mTLS cert when available */
    spiffeId?: string;
    credentialIdentity?: string;
}
export interface VerificationScore {
    composite: number;
    dimensions: Record<string, number>;
    action: 'allow' | 'step_up' | 'block';
    reason: string;
    stepUpRequestId?: string;
}
export declare class ZeroTrustVerificationEngine {
    private readonly reputation?;
    private readonly biometrics?;
    private readonly intent?;
    private readonly certifier?;
    private readonly approvalGate?;
    constructor(reputation?: ReputationEngine | undefined, biometrics?: BehaviorFingerprintEngine | undefined, intent?: IntentEngine | undefined, certifier?: MCPCertifier | undefined, approvalGate?: ApprovalGate | undefined);
    score(ctx: VerificationContext): VerificationScore;
    private scoreSpiffe;
    private scoreBiometrics;
    private scoreIntent;
    private scoreReputation;
    private scoreCertification;
    private scoreContext;
}
//# sourceMappingURL=verification-engine.d.ts.map