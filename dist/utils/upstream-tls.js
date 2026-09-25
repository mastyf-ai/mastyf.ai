export function isPlaintextUpstreamAllowed() {
    if (process.env['MASTYF_AI_STRICT_MODE'] === 'true') {
        return false;
    }
    return process.env['MASTYF_AI_ALLOW_PLAINTEXT_UPSTREAM'] === 'true';
}
/** Reject http:// upstream unless dev-only plaintext flag is set (never in strict mode). */
export function assertUpstreamTlsAllowed(targetUrl) {
    let parsed;
    try {
        parsed = new URL(targetUrl);
    }
    catch {
        return { ok: false, message: 'Invalid upstream URL' };
    }
    if (parsed.protocol === 'http:' && !isPlaintextUpstreamAllowed()) {
        return {
            ok: false,
            message: 'Plaintext HTTP upstream is disabled. Use https:// or set MASTYF_AI_ALLOW_PLAINTEXT_UPSTREAM=true (dev only; blocked when MASTYF_AI_STRICT_MODE=true).',
        };
    }
    return { ok: true };
}
/** Mandatory choke point — all proxy transports must call this before connecting upstream. */
export function requireUpstreamTlsAllowed(targetUrl) {
    const result = assertUpstreamTlsAllowed(targetUrl);
    if (!result.ok) {
        throw new Error(result.message);
    }
}
//# sourceMappingURL=upstream-tls.js.map