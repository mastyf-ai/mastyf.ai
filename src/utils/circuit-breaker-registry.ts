/**
 * Per-tenant circuit breakers — isolates failure domains across tenants.
 */
import { CircuitBreaker } from './circuit-breaker.js';

const breakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(tenantId: string, serverName: string): CircuitBreaker {
  const key = `${tenantId || 'default'}:${serverName}`;
  let cb = breakers.get(key);
  if (!cb) {
    cb = new CircuitBreaker(key, { resetTimeoutMs: 15000 });
    breakers.set(key, cb);
  }
  return cb;
}

/** @internal */
export function resetCircuitBreakerRegistryForTests(): void {
  breakers.clear();
}
