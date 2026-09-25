/** Unified upstream MCP / HTTP timeout for proxy transports. */
export function getUpstreamTimeoutMs() {
    const raw = process.env.MASTYF_AI_UPSTREAM_TIMEOUT_MS;
    if (raw == null || raw === '')
        return 30_000;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 30_000;
}
//# sourceMappingURL=upstream-timeout.js.map