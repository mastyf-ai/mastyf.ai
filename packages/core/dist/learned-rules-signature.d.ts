export interface LearnedRulesSignatureEnvelope {
    alg: "Ed25519";
    issuer: string;
    keyId: string;
    issuedAt: string;
    expiresAt?: string;
    signature: string;
}
export interface LearnedRulesSignatureValidationResult {
    ok: boolean;
    reason?: string;
}
export declare function learnedRulesSignaturePath(rulesPath: string): string;
export declare function readLearnedRulesSignatureEnvelope(rulesPath: string): LearnedRulesSignatureEnvelope | undefined;
export declare function writeLearnedRulesSignatureEnvelope(rulesPath: string, envelope: LearnedRulesSignatureEnvelope): void;
export declare function signLearnedRulesJson(json: string, envelope: Omit<LearnedRulesSignatureEnvelope, "signature">): LearnedRulesSignatureEnvelope;
export declare function isLearnedRulesSignatureRequired(): boolean;
export declare function validateSignedLearnedRulesJson(json: string, envelope: LearnedRulesSignatureEnvelope | undefined): LearnedRulesSignatureValidationResult;
export declare function hasLearnedRulesSigningKey(): boolean;
//# sourceMappingURL=learned-rules-signature.d.ts.map