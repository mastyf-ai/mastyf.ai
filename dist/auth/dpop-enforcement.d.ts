export declare function resetDpopEnforcementForTests(): void;
/** Legacy bypass for deployments that cannot send DPoP yet. */
export declare function isDpopLegacyBypass(): boolean;
/** When true, proxy rejects requests without a valid DPoP proof (RFC 9449). */
export declare function isDpopRequired(policyMode?: 'audit' | 'warn' | 'block'): boolean;
/**
 * Validate DPoP when MASTYF_AI_REQUIRE_DPOP=true.
 * Proof JWT must include `jwk` in the protected header (RFC 9449).
 */
export declare function validateRequiredDpop(proofToken: string | undefined, httpMethod: string, httpUri: string, accessToken?: string, tenantId?: string, policyMode?: 'audit' | 'warn' | 'block'): Promise<{
    valid: boolean;
    error?: string;
}>;
/** Extract DPoP proof from MCP JSON-RPC meta or HTTP headers. */
export declare function extractDpopProof(sources: {
    metaAuth?: Record<string, unknown>;
    messageDpop?: string;
    headerDpop?: string | string[];
}): string | undefined;
//# sourceMappingURL=dpop-enforcement.d.ts.map