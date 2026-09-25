export interface PolicySignatureEnvelope {
    issuer: string;
    keyId: string;
    issuedAt: string;
    expiresAt?: string;
    signature: string;
}
export interface PolicySignatureValidationResult {
    ok: boolean;
    reason?: string;
}
export declare function signPolicyYaml(yaml: string, envelope: Omit<PolicySignatureEnvelope, 'signature'>): PolicySignatureEnvelope;
export declare function validateSignedPolicyYaml(yaml: string, envelope: PolicySignatureEnvelope | undefined): PolicySignatureValidationResult;
//# sourceMappingURL=policy-signature.d.ts.map