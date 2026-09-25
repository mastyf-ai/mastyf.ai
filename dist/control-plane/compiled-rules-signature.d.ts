export interface CompiledRulesSignatureEnvelope {
    issuer: string;
    keyId: string;
    issuedAt: string;
    expiresAt?: string;
    signature: string;
}
export interface CompiledRulesSignatureValidationResult {
    ok: boolean;
    reason?: string;
}
export declare function signCompiledRules(rulesJson: string, envelope: Omit<CompiledRulesSignatureEnvelope, 'signature'>): CompiledRulesSignatureEnvelope;
export declare function validateSignedCompiledRules(rulesJson: string, envelope: CompiledRulesSignatureEnvelope | undefined): CompiledRulesSignatureValidationResult;
//# sourceMappingURL=compiled-rules-signature.d.ts.map