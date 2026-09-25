export type SignedPricingEnvelope = {
    version: number;
    issuedAt: string;
    issuer: string;
    keyId: string;
    alg: 'Ed25519';
    models: Record<string, {
        input: number;
        output: number;
    }>;
    signature: string;
};
export declare function validateSignedPricingEnvelope(envelope: SignedPricingEnvelope): {
    ok: boolean;
    reason?: string;
};
export declare function detectZeroPricingAlert(models: Record<string, {
    input: number;
    output: number;
}>): string[];
//# sourceMappingURL=pricing-signature.d.ts.map