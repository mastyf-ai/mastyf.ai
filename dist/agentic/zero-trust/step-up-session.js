/**
 * C3 — Step-up session state shared between ZeroTrustVerificationEngine and ApprovalGate.
 */
const pending = new Map();
const cleared = new Map();
export function stepUpSessionKey(agentId, sessionId) {
    return `${agentId}|${sessionId}`;
}
export function isStepUpCleared(key) {
    const exp = cleared.get(key);
    if (!exp)
        return false;
    if (Date.now() > exp) {
        cleared.delete(key);
        return false;
    }
    return true;
}
export function markStepUpPending(key, requestId) {
    pending.set(key, requestId);
}
export function hasPendingStepUp(key) {
    return pending.has(key);
}
export function clearStepUpForRequest(requestId, ttlMs = 900_000) {
    for (const [key, rid] of pending) {
        if (rid === requestId) {
            pending.delete(key);
            cleared.set(key, Date.now() + ttlMs);
            return true;
        }
    }
    return false;
}
export function clearStepUpStateForTests() {
    pending.clear();
    cleared.clear();
}
//# sourceMappingURL=step-up-session.js.map