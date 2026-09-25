import type { ReputationNetwork } from './reputation-network.js';
export declare function pullReputationEntriesFromMesh(network: ReputationNetwork, limit?: number): Promise<number>;
/** Export quorum attestation bundle for a server (B1 decentralized sync). */
export declare function exportReputationAttestationBundle(network: ReputationNetwork, serverName: string, packageName?: string): {
    entry: ReturnType<ReputationNetwork['queryServerReputation']>;
    votes: unknown[];
};
//# sourceMappingURL=reputation-mesh-pull.d.ts.map