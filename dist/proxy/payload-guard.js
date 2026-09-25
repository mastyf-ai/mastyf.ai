/**
 * Payload size limits — raw wire bytes and post-normalization expansion.
 */
import { getHttpMaxBodyBytes } from './http-proxy-security.js';
const DEFAULT_MAX_EXPANDED = 52_428_800; // 50 MB
export function getMaxPayloadBytes() {
    const raw = process.env['MASTYF_AI_MAX_PAYLOAD_BYTES'] ??
        process.env['MASTYF_AI_HTTP_MAX_BODY_BYTES'];
    if (raw !== undefined && raw !== '') {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n) && n > 0)
            return n;
    }
    return getHttpMaxBodyBytes();
}
export function getMaxExpandedPayloadBytes() {
    const raw = process.env['MASTYF_AI_MAX_EXPANDED_PAYLOAD_BYTES'];
    if (raw === undefined || raw === '')
        return DEFAULT_MAX_EXPANDED;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_EXPANDED;
}
export function utf8ByteLength(value) {
    return Buffer.byteLength(value, 'utf8');
}
export function measureJsonUtf8Bytes(value) {
    try {
        return utf8ByteLength(JSON.stringify(value));
    }
    catch {
        return Number.MAX_SAFE_INTEGER;
    }
}
export function checkRawPayloadSize(raw) {
    const bytes = typeof raw === 'string' ? utf8ByteLength(raw) : raw.length;
    const limit = getMaxPayloadBytes();
    if (bytes > limit) {
        return {
            ok: false,
            reason: `Payload exceeds ${limit} byte limit (${bytes} bytes)`,
            code: 'raw_oversize',
        };
    }
    return { ok: true };
}
export function checkExpandedPayload(args) {
    const limit = getMaxExpandedPayloadBytes();
    const bytes = measureJsonUtf8Bytes(args);
    if (bytes > limit) {
        return {
            ok: false,
            reason: `Expanded tool arguments exceed ${limit} byte limit (${bytes} bytes)`,
            code: 'expanded_oversize',
        };
    }
    return { ok: true };
}
//# sourceMappingURL=payload-guard.js.map