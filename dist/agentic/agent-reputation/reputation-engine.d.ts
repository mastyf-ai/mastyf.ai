/** #9 Agent Reputation & Behavior Scoring */
import { IndustryStandardStore } from '../../database/industry-standard-store.js';
export interface AgentReputation {
    agentId: string;
    score: number;
    tier: 'trusted' | 'standard' | 'suspicious' | 'blocked';
    totalCalls: number;
    blockedCalls: number;
    bypassRate: number;
    avgArgumentEntropy: number;
    toolDiversity: number;
    lastUpdated: string;
    trend: 'improving' | 'stable' | 'declining';
}
export declare class ReputationEngine {
    private readonly store?;
    private agents;
    constructor(store?: IndustryStandardStore | undefined);
    record(agentId: string, toolName: string, blocked: boolean, argLength: number): void;
    /** Incorporate A3 biometric anomaly signal into reputation score. */
    recordBiometricSignal(agentId: string, anomalyScore: number, credentialMismatch?: boolean): void;
    getScore(agentId: string): AgentReputation;
    private computeTrend;
    getPolicyForAgent(agentId: string): {
        mode: 'strict' | 'standard' | 'relaxed';
        message: string;
    };
}
//# sourceMappingURL=reputation-engine.d.ts.map