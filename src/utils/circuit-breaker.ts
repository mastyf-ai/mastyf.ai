/**
 * Circuit Breaker for MCP Proxy Server.
 * Implements the classic 3-state circuit breaker pattern:
 * CLOSED → OPEN → HALF_OPEN → CLOSED (or OPEN again).
 *
 * Used to protect upstream MCP servers from cascading failures.
 */
import { Logger } from './logger.js';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount: number = 0;
  private successCount: number = 0;
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
        Logger.debug(`[circuit-breaker:${this.name}] Transitioned to HALF_OPEN`);
        return true;
      }
      return false;
    }
    // HALF_OPEN: allow probes
    return true;
  }

  /** Record a successful request */
  recordSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.successCount = 0;
        Logger.info(`[circuit-breaker:${this.name}] Circuit CLOSED — service healthy`);
      }
    } else if (this.state === 'CLOSED') {
      this.failureCount = 0;
    }
  }

  /** Record a failed request */
  recordFailure(): void {
    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.successCount = 0;
      this.openedAt = Date.now();
      Logger.warn(`[circuit-breaker:${this.name}] Circuit OPEN — half-open probe failed`);
    } else if (this.state === 'CLOSED') {
      this.failureCount++;
      if (this.failureCount >= this.failureThreshold) {
        this.state = 'OPEN';
        this.openedAt = Date.now();
        Logger.warn(`[circuit-breaker:${this.name}] Circuit OPEN — ${this.failureCount} consecutive failures`);
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
}