import type { IndustryStandardStore } from '../../database/industry-standard-store.js';
export interface BehaviorObservation {
    agentId: string;
    toolName: string;
    argBytes: number;
    interCallMs?: number;
    timestamp: number;
    credentialIdentity?: string;
}
export interface BehaviorFingerprint {
    agentId: string;
    sampleCount: number;
    avgInterCallMs: number;
    avgArgBytes: number;
    toolOrder: string[];
    argShapeHash: string;
    updatedAt: string;
}
export interface AnomalyResult {
    score: number;
    reason: string;
    blocked: boolean;
}
export declare class BehaviorFingerprintEngine {
    private readonly store?;
    private fingerprints;
    private lastCallAt;
    private credentialBindings;
    constructor(store?: IndustryStandardStore | undefined);
    observe(obs: BehaviorObservation): BehaviorFingerprint;
    scoreAnomaly(agentId: string, obs: BehaviorObservation): AnomalyResult;
    getFingerprint(agentId: string): BehaviorFingerprint | null;
    listAnomalies(limit?: number): Array<{
        agentId: string;
        anomalyScore: number;
        reason: string;
        createdAt: string;
    }>;
}
export declare function resetBehaviorFingerprintEngineForTests(): void;
//# sourceMappingURL=behavior-fingerprint.d.ts.map