import type { IndustryStandardStore } from '../../database/industry-standard-store.js';
export interface TwinObservation {
    serverName: string;
    toolName: string;
    latencyMs: number;
    responseShape: string;
    schemaHash?: string;
    argsJson?: Record<string, unknown>;
}
export interface DigitalTwinSnapshot {
    id: string;
    serverName: string;
    schemaJson: Record<string, unknown>;
    latencyP50Ms: number;
    latencyP99Ms: number;
    responseShapeHash: string;
    sampleCount: number;
    capturedAt: string;
}
export interface SandboxScorecard {
    attacksBlockedPct: number;
    workflowsPreservedPct: number;
    latencyDeltaP99Ms: number;
    goNoGo: 'go' | 'review' | 'no-go';
    reason: string;
    /** UI-friendly aliases */
    attackBlockRate?: number;
    workflowPreservation?: number;
    latencyDeltaPct?: number;
    summary?: string;
}
export declare class DigitalTwinCapture {
    private readonly store?;
    private observations;
    constructor(store?: IndustryStandardStore | undefined);
    /** Load recent persisted observations on startup (cross-restart twin). */
    hydrateFromStore(serverName: string): void;
    record(obs: TwinObservation): void;
    snapshot(serverName: string): DigitalTwinSnapshot | null;
    getBaselineP99(serverName: string): number;
    scoreSandbox(params: {
        attacksBlocked: number;
        attacksTotal: number;
        workflowsPreserved: number;
        workflowsTotal: number;
        baselineP99Ms: number;
        sandboxP99Ms: number;
        capturedReplayed?: number;
        capturedPassRate?: number;
    }): SandboxScorecard;
}
//# sourceMappingURL=twin-capture.d.ts.map