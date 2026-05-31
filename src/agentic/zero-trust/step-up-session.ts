/**
 * C3 — Step-up session state shared between ZeroTrustVerificationEngine and ApprovalGate.
 */
const pending = new Map<string, string>();
const cleared = new Map<string, number>();

export function stepUpSessionKey(agentId: string, sessionId: string): string {
  return `${agentId}|${sessionId}`;
}

export function isStepUpCleared(key: string): boolean {
  const exp = cleared.get(key);
  if (!exp) return false;
  if (Date.now() > exp) {
    cleared.delete(key);
    return false;
  }
  return true;
}

export function markStepUpPending(key: string, requestId: string): void {
  pending.set(key, requestId);
}

export function hasPendingStepUp(key: string): boolean {
  return pending.has(key);
}

export function clearStepUpForRequest(requestId: string, ttlMs = 900_000): boolean {
  for (const [key, rid] of pending) {
    if (rid === requestId) {
      pending.delete(key);
      cleared.set(key, Date.now() + ttlMs);
      return true;
    }
  }
  return false;
}

export function clearStepUpStateForTests(): void {
  pending.clear();
  cleared.clear();
}
