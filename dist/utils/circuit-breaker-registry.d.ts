/**
 * Per-tenant circuit breakers — isolates failure domains across tenants.
 */
import { CircuitBreaker } from './circuit-breaker.js';
export declare function getCircuitBreaker(tenantId: string, serverName: string): CircuitBreaker;
/** @internal */
export declare function resetCircuitBreakerRegistryForTests(): void;
//# sourceMappingURL=circuit-breaker-registry.d.ts.map