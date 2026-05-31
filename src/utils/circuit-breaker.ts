/**
 * Circuit Breaker for MCP Proxy Server.
 * Implements the classic 3-state circuit breaker pattern:
 * CLOSED → OPEN → HALF_OPEN → CLOSED (or OPEN again).
 *
 * Used to protect upstream MCP servers from cascading failures.
 */
import { Logger } from './logger.js';
import { saveCircuitToRedis } from './redis-circuit-sync.js';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount: number = 0;
  private successCount: number = 0;
  /** True while a HALF_OPEN probe is in flight — only one probe allowed. */
  private probing = false;
  /** Timestamp when the circuit first transitioned to OPEN (used for recovery timer) */
  private openedAt: number = 0;
  private readonly resetTimeout: number;
  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly name: string;

  constructor(
    name: string,
    options: { failureThreshold?: number; successThreshold?: number; resetTimeoutMs?: number } = {}
  ) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || 5;
    this.successThreshold = options.successThreshold || 2;
    this.resetTimeout = options.resetTimeoutMs || 30000;
  }

  /** Check if the circuit allows a request through */
  allowRequest(): boolean {
    if (this.state === 'CLOSED') return true;
    if (this.state === 'OPEN') {
      if (Date.now() - this.openedAt >= this.resetTimeout) {
        this.state = 'HALF_OPEN';
        this.probing = false;
        Logger.debug(`[circuit-breaker:${this.name}] Transitioned to HALF_OPEN`);
      } else {
        return false;
      }
    }
    if (this.state === 'HALF_OPEN') {
      if (this.probing) return false;
      this.probing = true;
      return true;
    }
    return true;
  }

  /** Record a successful request */
  recordSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.probing = false;
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.successCount = 0;
        Logger.info(`[circuit-breaker:${this.name}] Circuit CLOSED — service healthy`);
        this.syncRedis();
      }
    } else if (this.state === 'CLOSED') {
      this.failureCount = 0;
    }
  }

  /** Record a failed request */
  recordFailure(): void {
    if (this.state === 'HALF_OPEN') {
      this.probing = false;
      this.state = 'OPEN';
      this.successCount = 0;
      this.openedAt = Date.now();
      Logger.warn(`[circuit-breaker:${this.name}] Circuit OPEN — half-open probe failed`);
      this.syncRedis();
    } else if (this.state === 'CLOSED') {
      this.failureCount++;
      if (this.failureCount >= this.failureThreshold) {
        this.state = 'OPEN';
        this.openedAt = Date.now();
        Logger.warn(`[circuit-breaker:${this.name}] Circuit OPEN — ${this.failureCount} consecutive failures`);
        this.syncRedis();
      }
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getStats(): { state: CircuitState; failureCount: number; successCount: number } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
    };
  }

  /** Force circuit open (incident isolation). */
  forceOpen(reason?: string): void {
    this.state = 'OPEN';
    this.openedAt = Date.now();
    this.failureCount = this.failureThreshold;
    Logger.warn(`[circuit-breaker:${this.name}] Circuit force-opened${reason ? `: ${reason}` : ''}`);
    this.syncRedis();
  }

  private syncRedis(): void {
    void saveCircuitToRedis(this.name, {
      state: this.state,
      failureCount: this.failureCount,
      openedAt: this.openedAt,
    });
  }

  /** Hydrate from Redis snapshot (multi-replica). */
  applyRedisSnapshot(snap: { state: CircuitState; failureCount: number; openedAt: number }): void {
    this.state = snap.state;
    this.failureCount = snap.failureCount;
    this.openedAt = snap.openedAt;
  }
}