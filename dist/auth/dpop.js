import * as jose from 'jose';
import { Logger } from '../utils/logger.js';
import { createDPoPNonceStore, InMemoryDPoPNonceStore, } from './dpop-nonce-store.js';
/** RFC 9449 URI comparison — strip fragment; normalize path (no trailing slash except root). */
export function normalizeDpopUri(uri) {
    try {
        const u = new URL(uri);
        u.hash = '';
        if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
            u.pathname = u.pathname.slice(0, -1);
        }
        return u.toString();
    }
    catch {
        return uri.split('#')[0].replace(/\/$/, '') || uri;
    }
}
export class DPoPValidator {
    nonceStore;
    nonceTtlMs;
    constructor(nonceTtlMs = 10 * 60 * 1000, nonceStore) {
        this.nonceTtlMs = nonceTtlMs;
        this.nonceStore = nonceStore ?? createDPoPNonceStore(nonceTtlMs);
    }
    /** Derive algorithm from JWK */
    inferAlgorithm(jwk) {
        if (jwk.alg)
            return jwk.alg;
        if (jwk.kty === 'EC') {
            return jwk.crv === 'P-384' ? 'ES384' : 'ES256';
        }
        else if (jwk.kty === 'RSA') {
            return 'RS256';
        }
        else if (jwk.kty === 'OKP') {
            return 'EdDSA';
        }
        return 'ES256';
    }
    /**
     * Validate a DPoP proof JWT.
     * Checks: signature (JWK), htm, htu, iat freshness (60s window), ath (if access token provided), nonce replay.
     */
    async validate(proofToken, jwk, httpMethod, httpUri, accessToken, tenantId) {
        try {
            // Verify the proof JWT is signed by the client's private key matching the JWK
            const alg = this.inferAlgorithm(jwk);
            const publicKey = await jose.importJWK(jwk, alg);
            const { payload } = await jose.jwtVerify(proofToken, publicKey, {
                algorithms: ['ES256', 'ES384', 'RS256', 'EdDSA'],
                clockTolerance: 10,
            });
            const proof = payload;
            // Validate htm (HTTP method)
            if (proof.htm !== httpMethod.toUpperCase()) {
                return { valid: false, error: `DPoP: htm mismatch (expected ${httpMethod.toUpperCase()}, got ${proof.htm})` };
            }
            const normalizedExpected = normalizeDpopUri(httpUri);
            const normalizedProof = normalizeDpopUri(proof.htu);
            if (normalizedProof !== normalizedExpected) {
                return {
                    valid: false,
                    error: `DPoP: htu mismatch (expected ${normalizedExpected}, got ${normalizedProof})`,
                };
            }
            // Validate iat freshness (must be within last 60 seconds)
            const now = Math.floor(Date.now() / 1000);
            if (proof.iat < now - 60) {
                return { valid: false, error: 'DPoP: proof too old (iat > 60s ago)' };
            }
            if (proof.iat > now + 10) {
                return { valid: false, error: 'DPoP: proof from the future' };
            }
            if (this.nonceStore instanceof InMemoryDPoPNonceStore) {
                this.nonceStore.cleanupExpired();
            }
            if (!(await this.nonceStore.claim(proof.jti, tenantId))) {
                Logger.warn(`[dpop] Replay detected: jti ${proof.jti}`);
                return { valid: false, error: 'DPoP: nonce already used (replay detected)' };
            }
            // Validate ath (access token hash) if access token provided
            if (accessToken && proof.ath) {
                const expectedAth = await this.computeAth(accessToken);
                if (proof.ath !== expectedAth) {
                    return { valid: false, error: 'DPoP: ath mismatch (access token hash does not match)' };
                }
            }
            return { valid: true };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { valid: false, error: `DPoP validation failed: ${message}` };
        }
    }
    /**
     * Compute the access token hash (ath) as per RFC 9449 §4.2.
     * ath = base64url(sha256(access_token))
     */
    async computeAth(accessToken) {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accessToken));
        return Buffer.from(digest).toString('base64url');
    }
}
//# sourceMappingURL=dpop.js.map