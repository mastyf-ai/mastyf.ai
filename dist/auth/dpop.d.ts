import * as jose from 'jose';
import { type DPoPNonceStore } from './dpop-nonce-store.js';
/**
 * DPoP (Demonstrating Proof of Possession) — RFC 9449.
 * Validates sender-constrained tokens to prevent token replay.
 * The client must include a DPoP proof JWT in the DPoP header.
 */
export interface DPoPProof {
    /** The access token hash (ath) claim */
    ath?: string;
    /** The HTTP method of the request */
    htm: string;
    /** The HTTP URI of the request */
    htu: string;
    /** Issued at (Unix timestamp) */
    iat: number;
    /** Unique JWT ID for replay detection */
    jti: string;
}
/** RFC 9449 URI comparison — strip fragment; normalize path (no trailing slash except root). */
export declare function normalizeDpopUri(uri: string): string;
export declare class DPoPValidator {
    private readonly nonceStore;
    private readonly nonceTtlMs;
    constructor(nonceTtlMs?: number, nonceStore?: DPoPNonceStore);
    /** Derive algorithm from JWK */
    private inferAlgorithm;
    /**
     * Validate a DPoP proof JWT.
     * Checks: signature (JWK), htm, htu, iat freshness (60s window), ath (if access token provided), nonce replay.
     */
    validate(proofToken: string, jwk: jose.JWK, httpMethod: string, httpUri: string, accessToken?: string, tenantId?: string): Promise<{
        valid: boolean;
        error?: string;
    }>;
    /**
     * Compute the access token hash (ath) as per RFC 9449 §4.2.
     * ath = base64url(sha256(access_token))
     */
    private computeAth;
}
//# sourceMappingURL=dpop.d.ts.map