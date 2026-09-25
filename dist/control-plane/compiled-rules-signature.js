import { createHmac, timingSafeEqual } from 'crypto';
function signingSecretForKeyId(keyId) {
    const envKey = `MASTYF_AI_COMPILED_RULES_SIGNING_KEY_${keyId}`;
    return process.env[envKey]
        || process.env['MASTYF_AI_COMPILED_RULES_SIGNING_KEY']
        || process.env['MASTYF_AI_POLICY_SIGNING_KEY']
        || undefined;
}
function trustedIssuers() {
    const raw = process.env['MASTYF_AI_COMPILED_RULES_TRUSTED_ISSUERS']
        || process.env['MASTYF_AI_POLICY_TRUSTED_ISSUERS']
        || 'mastyf-ai-admin';
    return new Set(raw.split(',').map((v) => v.trim()).filter(Boolean));
}
function signatureInput(json, env) {
    return [json, env.issuer, env.keyId, env.issuedAt, env.expiresAt || ''].join('\n');
}
export function signCompiledRules(rulesJson, envelope) {
    const secret = signingSecretForKeyId(envelope.keyId);
    if (!secret) {
        throw new Error(`Missing compiled-rules signing secret for keyId '${envelope.keyId}'`);
    }
    const signature = createHmac('sha256', secret)
        .update(signatureInput(rulesJson, envelope))
        .digest('base64');
    return { ...envelope, signature };
}
export function validateSignedCompiledRules(rulesJson, envelope) {
    const required = process.env['MASTYF_AI_REQUIRE_SIGNED_COMPILED_RULES'] === 'true';
    if (!envelope) {
        return required ? { ok: false, reason: 'missing signature envelope' } : { ok: true };
    }
    if (!trustedIssuers().has(envelope.issuer)) {
        return { ok: false, reason: `untrusted issuer '${envelope.issuer}'` };
    }
    if (envelope.expiresAt && Date.now() > Date.parse(envelope.expiresAt)) {
        return { ok: false, reason: 'signature expired' };
    }
    const secret = signingSecretForKeyId(envelope.keyId);
    if (!secret) {
        return { ok: false, reason: `missing verifier key for keyId '${envelope.keyId}'` };
    }
    const expected = createHmac('sha256', secret)
        .update(signatureInput(rulesJson, {
        issuer: envelope.issuer,
        keyId: envelope.keyId,
        issuedAt: envelope.issuedAt,
        expiresAt: envelope.expiresAt,
    }))
        .digest('base64');
    const a = Buffer.from(expected);
    const b = Buffer.from(envelope.signature || '');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return { ok: false, reason: 'signature mismatch' };
    }
    return { ok: true };
}
//# sourceMappingURL=compiled-rules-signature.js.map