import { createPublicKey, verify } from 'node:crypto';
function publicKeyForPricing(keyId) {
    const envKey = `MASTYF_AI_PRICING_VERIFY_PUBLIC_KEY_${keyId}`;
    const raw = process.env[envKey] || process.env['MASTYF_AI_PRICING_VERIFY_PUBLIC_KEY'];
    if (!raw)
        return null;
    try {
        const jwk = JSON.parse(raw);
        return createPublicKey({ key: jwk, format: 'jwk' });
    }
    catch {
        return createPublicKey(raw);
    }
}
function signaturePayload(envelope) {
    const body = JSON.stringify({
        version: envelope.version,
        issuedAt: envelope.issuedAt,
        issuer: envelope.issuer,
        keyId: envelope.keyId,
        alg: envelope.alg,
        models: envelope.models,
    });
    return Buffer.from(body, 'utf-8');
}
export function validateSignedPricingEnvelope(envelope) {
    if (envelope.alg !== 'Ed25519') {
        return { ok: false, reason: `unsupported pricing signature alg '${envelope.alg}'` };
    }
    const publicKey = publicKeyForPricing(envelope.keyId);
    if (!publicKey) {
        return { ok: false, reason: `missing pricing verify public key for keyId '${envelope.keyId}'` };
    }
    const ok = verify(null, signaturePayload(envelope), publicKey, Buffer.from(envelope.signature, 'base64'));
    if (!ok)
        return { ok: false, reason: 'pricing signature mismatch' };
    return { ok: true };
}
export function detectZeroPricingAlert(models) {
    const alerts = [];
    for (const [model, rates] of Object.entries(models)) {
        if (rates.input <= 0 && rates.output <= 0) {
            alerts.push(model);
        }
    }
    return alerts;
}
//# sourceMappingURL=pricing-signature.js.map