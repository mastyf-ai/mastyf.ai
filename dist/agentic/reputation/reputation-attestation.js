/**
 * B1 — HMAC attestation for reputation network entries.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { getCertSigningKey } from '../certification/cert-signing.js';
function b64url(input) {
    return Buffer.from(input).toString('base64url');
}
function fromB64url(input) {
    return Buffer.from(input, 'base64url').toString('utf-8');
}
export function signReputationAttestation(payload) {
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'MASTYF_AI-REP+JWS' }));
    const body = b64url(JSON.stringify(payload));
    const signingInput = `${header}.${body}`;
    const signature = createHmac('sha256', getCertSigningKey()).update(signingInput).digest('base64url');
    return `${signingInput}.${signature}`;
}
export function verifyReputationAttestation(jws) {
    const parts = jws.split('.');
    if (parts.length !== 3)
        return { valid: false, reason: 'invalid_jws_format' };
    const [header, body, signature] = parts;
    const signingInput = `${header}.${body}`;
    const expected = createHmac('sha256', getCertSigningKey()).update(signingInput).digest('base64url');
    try {
        const sigBuf = Buffer.from(signature, 'base64url');
        const expBuf = Buffer.from(expected, 'base64url');
        if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
            return { valid: false, reason: 'bad_signature' };
        }
    }
    catch {
        return { valid: false, reason: 'bad_signature' };
    }
    try {
        const payload = JSON.parse(fromB64url(body));
        if (!payload.serverName || !payload.raterId || !payload.dimensions) {
            return { valid: false, reason: 'invalid_payload' };
        }
        return { valid: true, payload };
    }
    catch {
        return { valid: false, reason: 'invalid_payload' };
    }
}
//# sourceMappingURL=reputation-attestation.js.map