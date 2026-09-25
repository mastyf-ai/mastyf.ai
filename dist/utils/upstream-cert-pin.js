/**
 * Upstream TLS certificate pinning (SPKI SHA-256).
 * MASTYF_AI_UPSTREAM_CERT_PIN_SHA256 — comma-separated base64 or hex SPKI hashes.
 */
import { createHash } from 'crypto';
import { Logger } from './logger.js';
let cachedPins = null;
export function resetUpstreamCertPinsForTests() {
    cachedPins = null;
}
export function loadUpstreamCertPins() {
    if (cachedPins)
        return cachedPins;
    const raw = process.env['MASTYF_AI_UPSTREAM_CERT_PIN_SHA256'] || '';
    cachedPins = new Set(raw
        .split(',')
        .map((s) => s.trim().toLowerCase().replace(/^sha256\//i, ''))
        .filter(Boolean));
    if (cachedPins.size > 0) {
        Logger.info(`[cert-pin] Loaded ${cachedPins.size} upstream SPKI pin(s)`);
    }
    return cachedPins;
}
export function spkiSha256FromDer(certDer) {
    return createHash('sha256').update(certDer).digest('hex');
}
/** Node checkServerIdentity hook — validates leaf cert SPKI against configured pins. */
export function createCertPinCheck() {
    const pins = loadUpstreamCertPins();
    if (pins.size === 0)
        return undefined;
    return (_host, cert) => {
        const hash = spkiSha256FromDer(cert.raw);
        if (!pins.has(hash)) {
            return new Error(`Upstream certificate SPKI pin mismatch (got ${hash.slice(0, 16)}…)`);
        }
        return undefined;
    };
}
/** Attach cert pin validation to an https.Agent options object. */
export function applyCertPinToAgentOptions(opts) {
    const check = createCertPinCheck();
    if (!check)
        return opts;
    const prev = opts.checkServerIdentity;
    opts.checkServerIdentity = (host, cert) => {
        const pinErr = check(host, cert);
        if (pinErr)
            return pinErr;
        if (prev)
            return prev(host, cert);
        return undefined;
    };
    return opts;
}
export function assertPinnedTlsSocket(socket) {
    const pins = loadUpstreamCertPins();
    if (pins.size === 0)
        return;
    const peer = socket.getPeerCertificate();
    if (!peer?.raw) {
        throw new Error('Upstream TLS peer certificate unavailable for pinning');
    }
    const hash = spkiSha256FromDer(peer.raw);
    if (!pins.has(hash)) {
        throw new Error(`Upstream certificate SPKI pin mismatch (got ${hash.slice(0, 16)}…)`);
    }
}
//# sourceMappingURL=upstream-cert-pin.js.map