import type { ReputationDimensions } from './reputation-network.js';
export interface ReputationAttestationPayload {
    serverName: string;
    packageName?: string;
    dimensions: ReputationDimensions;
    raterId: string;
    raterWeight: number;
    issuedAt: string;
}
export declare function signReputationAttestation(payload: ReputationAttestationPayload): string;
export declare function verifyReputationAttestation(jws: string): {
    valid: boolean;
    payload?: ReputationAttestationPayload;
    reason?: string;
};
//# sourceMappingURL=reputation-attestation.d.ts.map