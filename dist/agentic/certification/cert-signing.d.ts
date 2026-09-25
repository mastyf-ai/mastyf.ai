export interface CertAttestationPayload {
    serverName: string;
    packageName: string;
    version: string;
    level: string;
    score: number;
    issuedAt: string;
    expiresAt: string;
}
export declare function getCertSigningKey(): string;
export declare function signCertAttestation(payload: CertAttestationPayload): string;
export declare function verifyCertAttestation(jws: string): {
    valid: boolean;
    payload?: CertAttestationPayload;
    reason?: string;
};
//# sourceMappingURL=cert-signing.d.ts.map