import { createPublicKey, verify } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
const PREFIX = 'MSH1';
const GRACE_MS = 14 * 24 * 60 * 60 * 1000;
function fromB64url(s) {
    const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
    return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}
export function looksLikeLemonKey(token) {
    const raw = String(token || '').trim();
    if (!raw || raw.startsWith('MSH1.'))
        return false;
    if (raw.length < 10 || raw.length > 128)
        return false;
    return /^[A-Za-z0-9_-]+(-[A-Za-z0-9_-]+)+$/.test(raw) || /^[A-Za-z0-9]{16,}$/.test(raw);
}
export function readOfflinePublicKey(pemOrPath) {
    const raw = String(pemOrPath || '').trim();
    if (!raw)
        return '';
    if (raw.includes('BEGIN PUBLIC KEY'))
        return raw;
    if (existsSync(raw))
        return readFileSync(raw, 'utf8');
    return '';
}
export function verifyOfflineLicenseToken(token, publicPem, nowMs = Date.now(), machineId = '') {
    const raw = String(token || '').trim();
    const parts = raw.split('.');
    if (parts.length !== 3 || parts[0] !== PREFIX) {
        return { ok: false, reason: 'malformed' };
    }
    if (!publicPem)
        return { ok: false, reason: 'no-public-key' };
    let payload;
    try {
        payload = JSON.parse(fromB64url(parts[1]).toString('utf8'));
    }
    catch {
        return { ok: false, reason: 'payload' };
    }
    let key;
    try {
        key = createPublicKey(publicPem);
    }
    catch {
        return { ok: false, reason: 'public-key' };
    }
    let sigOk = false;
    try {
        sigOk = verify(null, Buffer.from(parts[1], 'utf8'), key, fromB64url(parts[2]));
    }
    catch {
        sigOk = false;
    }
    if (!sigOk)
        return { ok: false, reason: 'signature', payload };
    if (payload.v !== 1 || payload.product !== 'shield') {
        return { ok: false, reason: 'product', payload };
    }
    const expMs = Number(payload.exp || 0) * 1000;
    if (!expMs)
        return { ok: false, reason: 'no-expiry', payload };
    if (nowMs > expMs + GRACE_MS) {
        return { ok: false, reason: 'expired', payload };
    }
    const bound = String(payload.mid || '').trim();
    if (bound && machineId && bound !== machineId) {
        return { ok: false, reason: 'machine-mismatch', payload };
    }
    return {
        ok: true,
        payload,
        grace: nowMs > expMs,
        expiresAt: new Date(expMs).toISOString(),
    };
}
//# sourceMappingURL=offline-license.js.map