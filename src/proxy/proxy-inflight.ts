/**
 * Shared max in-flight limit for tools/call across proxy transports.
 */
export function proxyMaxInflight(): number {
  const raw = process.env['GUARDIAN_PROXY_MAX_INFLIGHT'] ?? '50';
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 50;
}

export function isProxyInflightExceeded(currentInFlight: number): boolean {
  return currentInFlight >= proxyMaxInflight();
}

const serverInflightCounts = new Map<string, number>();

/** Acquire in-flight slot for stateless HTTP/SSE transports. */
export function acquireProxyInflight(serverName: string): {
  ok: boolean;
  current: number;
  max: number;
} {
  const current = serverInflightCounts.get(serverName) ?? 0;
  const max = proxyMaxInflight();
  if (current >= max) {
    return { ok: false, current, max };
  }
  serverInflightCounts.set(serverName, current + 1);
  return { ok: true, current: current + 1, max };
}

export function releaseProxyInflight(serverName: string): void {
  const current = serverInflightCounts.get(serverName) ?? 0;
  if (current <= 1) {
    serverInflightCounts.delete(serverName);
  } else {
    serverInflightCounts.set(serverName, current - 1);
  }
}

/** @internal */
export function resetProxyInflightForTests(): void {
  serverInflightCounts.clear();
}
