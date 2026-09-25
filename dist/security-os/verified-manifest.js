/**
 * Mastyf Verified — signed package/server manifest.
 * Trust profile *states*, never a composite score (no fake 94/100).
 * Keys missing → status UNAVAILABLE (honest).
 */
import { createHmac, timingSafeEqual, createHash } from 'crypto';
function signingSecretForKeyId(keyId) {
    return (process.env[`MASTYF_VERIFIED_SIGNING_KEY_${keyId}`]
        || process.env['MASTYF_VERIFIED_SIGNING_KEY']
        || process.env['MASTYF_AI_VERIFIED_SIGNING_KEY']
        || undefined);
}
function trustedKeyIds() {
    const raw = process.env['MASTYF_VERIFIED_TRUSTED_KEYS']
        || process.env['MASTYF_AI_VERIFIED_TRUSTED_KEYS']
        || '';
    return new Set(raw.split(',').map((v) => v.trim()).filter(Boolean));
}
function canonicalPayload(manifest) {
    const { signature: _s, ...rest } = manifest;
    void _s;
    return JSON.stringify(rest, Object.keys(rest).sort());
}
export function hasVerifiedSigningKey(keyId = 'default') {
    return Boolean(signingSecretForKeyId(keyId));
}
export function signVerifiedManifest(unsigned) {
    const secret = signingSecretForKeyId(unsigned.key_id);
    if (!secret) {
        throw new Error(`MASTYF_VERIFIED signing key unavailable for key_id '${unsigned.key_id}' — refuse to fake signature`);
    }
    const signature = createHmac('sha256', secret)
        .update(canonicalPayload(unsigned))
        .digest('base64');
    return { ...unsigned, signature };
}
export function verifyVerifiedManifest(manifest) {
    const unavailableStates = () => ({
        identity: 'UNAVAILABLE',
        integrity: 'UNAVAILABLE',
        capabilities: 'UNAVAILABLE',
        egress: 'UNAVAILABLE',
        audit: 'UNAVAILABLE',
    });
    if (!manifest) {
        return {
            status: 'UNAVAILABLE',
            states: unavailableStates(),
            reason: 'no verified manifest provided',
        };
    }
    if (!manifest.signature) {
        return {
            status: 'UNSIGNED',
            states: {
                identity: 'DECLARED',
                integrity: 'DECLARED',
                capabilities: manifest.capabilities.length ? 'DECLARED' : 'ABSENT',
                egress: manifest.egress.length ? 'DECLARED' : 'ABSENT',
                audit: manifest.audit_refs.length ? 'DECLARED' : 'ABSENT',
            },
            reason: 'manifest present but unsigned',
            manifest,
        };
    }
    const secret = signingSecretForKeyId(manifest.key_id);
    if (!secret) {
        return {
            status: 'UNAVAILABLE',
            states: unavailableStates(),
            reason: `verifier key unavailable for key_id '${manifest.key_id}'`,
            manifest,
        };
    }
    const trusted = trustedKeyIds();
    if (trusted.size > 0 && !trusted.has(manifest.key_id)) {
        return {
            status: 'FAILED',
            states: {
                identity: 'FAILED',
                integrity: 'FAILED',
                capabilities: 'UNKNOWN',
                egress: 'UNKNOWN',
                audit: 'UNKNOWN',
            },
            reason: `untrusted key_id '${manifest.key_id}'`,
            manifest,
        };
    }
    if (manifest.expires_at && Date.now() > Date.parse(manifest.expires_at)) {
        return {
            status: 'EXPIRED',
            states: {
                identity: 'FAILED',
                integrity: 'UNKNOWN',
                capabilities: 'DECLARED',
                egress: 'DECLARED',
                audit: 'DECLARED',
            },
            reason: 'manifest expired',
            manifest,
        };
    }
    const expected = createHmac('sha256', secret)
        .update(canonicalPayload(manifest))
        .digest('base64');
    const a = Buffer.from(expected);
    const b = Buffer.from(manifest.signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return {
            status: 'FAILED',
            states: {
                identity: 'FAILED',
                integrity: 'CHANGED',
                capabilities: 'UNKNOWN',
                egress: 'UNKNOWN',
                audit: 'UNKNOWN',
            },
            reason: 'signature mismatch',
            manifest,
        };
    }
    return {
        status: 'VERIFIED',
        states: {
            identity: 'VERIFIED',
            integrity: 'VERIFIED',
            capabilities: manifest.capabilities.length ? 'VERIFIED' : 'ABSENT',
            egress: manifest.egress.length ? 'VERIFIED' : 'ABSENT',
            audit: manifest.audit_refs.length ? 'VERIFIED' : 'ABSENT',
        },
        reason: 'signature valid — trust profile states, not a score',
        manifest,
    };
}
export function digestPinMaterial(material) {
    return createHash('sha256').update(material).digest('hex');
}
//# sourceMappingURL=verified-manifest.js.map