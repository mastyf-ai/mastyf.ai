import type { EcosystemObservatory } from './ecosystem-observatory.js';
export declare function publishObservatorySnapshotToMesh(observatory: EcosystemObservatory): Promise<{
    ok: boolean;
    error?: string;
}>;
export declare function pullObservatorySnapshotsFromMesh(observatory: EcosystemObservatory, limit?: number): Promise<number>;
//# sourceMappingURL=observatory-mesh-relay.d.ts.map