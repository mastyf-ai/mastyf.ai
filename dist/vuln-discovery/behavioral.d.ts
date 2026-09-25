import type { VulnFinding } from './types.js';
export interface BehavioralFeatureInput {
    toolName: string;
    arguments: unknown;
    serverName: string;
    timeSinceLastCallMs?: number;
}
/** Lightweight local reconstruction-error proxy when core autoencoder unavailable. */
export declare function scoreBehavioralAnomaly(input: BehavioralFeatureInput): {
    anomaly: boolean;
    score: number;
    threshold: number;
};
export declare function evaluateBehavioralAndRecord(input: BehavioralFeatureInput): Promise<VulnFinding | null>;
//# sourceMappingURL=behavioral.d.ts.map