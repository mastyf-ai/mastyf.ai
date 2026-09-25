/**
 * Shared max in-flight limit for tools/call across proxy transports.
 */
export function proxyMaxInflight() {
    const raw = process.env['MASTYF_AI_PROXY_MAX_INFLIGHT'] ?? '50';
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 50;
}
export function isProxyInflightExceeded(currentInFlight) {
    return currentInFlight >= proxyMaxInflight();
}
const serverInflightCounts = new Map();
/** Acquire in-flight slot for stateless HTTP/SSE transports. */
export function acquireProxyInflight(serverName) {
    const current = serverInflightCounts.get(serverName) ?? 0;
    const max = proxyMaxInflight();
    if (current >= max) {
        return { ok: false, current, max };
    }
    serverInflightCounts.set(serverName, current + 1);
    return { ok: true, current: current + 1, max };
}
export function releaseProxyInflight(serverName) {
    const current = serverInflightCounts.get(serverName) ?? 0;
    if (current <= 1) {
        serverInflightCounts.delete(serverName);
    }
    else {
        serverInflightCounts.set(serverName, current - 1);
    }
}
export function getTotalProxyInflight() {
    let total = 0;
    for (const n of serverInflightCounts.values())
        total += n;
    return total;
}
/** @internal */
export function resetProxyInflightForTests() {
    serverInflightCounts.clear();
}
//# sourceMappingURL=proxy-inflight.js.map