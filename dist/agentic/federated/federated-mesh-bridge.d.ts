import type { FederatedModelDelta } from './federated-learning.js';
export declare function pullFederatedDeltasFromMesh(limit?: number): Promise<FederatedModelDelta[]>;
export declare function publishFederatedDeltaViaMesh(delta: FederatedModelDelta): Promise<{
    ok: boolean;
    error?: string;
}>;
//# sourceMappingURL=federated-mesh-bridge.d.ts.map