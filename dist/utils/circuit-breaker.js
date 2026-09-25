/**
 * Circuit Breaker for MCP Proxy Server.
 * Implements the classic 3-state circuit breaker pattern:
 * CLOSED → OPEN → HALF_OPEN → CLOSED (or OPEN again).
 *
 * Used to protect upstream MCP servers from cascading failures.
 */
import { Logger } from './logger.js';
import { saveCircuitToRedis } from './redis-circuit-sync.js';
export class CircuitBreaker {
    state = 'CLOSED';
    failureCount = 0;
    successCount = 0;
    /** True while a HALF_OPEN probe is in flight — only one probe allowed. */
    probing = false;
    /** Timestamp when the circuit first transitioned to OPEN (used for recovery timer) */
    openedAt = 0;
    openCycles = 0;
    currentProbeTimeout;
    resetTimeout;
    failureThreshold;
    successThreshold;
    name;
    constructor(name, options = {}) {
        this.name = name;
        this.failureThreshold = options.failureThreshold || 5;
        this.successThreshold = options.successThreshold || 2;
        this.resetTimeout = options.resetTimeoutMs || 30000;
        this.currentProbeTimeout = this.resetTimeout;
    }
    maxProbeInterval() {
        return parseInt(process.env['MASTYF_AI_CIRCUIT_MAX_PROBE_INTERVAL_MS'] || '300000', 10);
    }
    nextProbeTimeout() {
        const base = this.resetTimeout * Math.pow(2, Math.max(0, this.openCycles - 1));
        const capped = Math.min(base, this.maxProbeInterval());
        const jitter = capped * 0.1 * (Math.random() * 2 - 1);
        return Math.round(capped + jitter);
    }
    /** Check if the circuit allows a request through */
    allowRequest() {
        if (this.state === 'CLOSED')
            return true;
        if (this.state === 'OPEN') {
            if (Date.now() - this.openedAt >= this.currentProbeTimeout) {
                this.state = 'HALF_OPEN';
                this.probing = false;
                Logger.debug(`[circuit-breaker:${this.name}] Transitioned to HALF_OPEN`);
            }
            else {
                return false;
            }
        }
        if (this.state === 'HALF_OPEN') {
            if (this.probing)
                return false;
            this.probing = true;
            return true;
        }
        return true;
    }
    /** Record a successful request */
    recordSuccess() {
        if (this.state === 'HALF_OPEN') {
            this.probing = false;
            this.successCount++;
            if (this.successCount >= this.successThreshold) {
                this.state = 'CLOSED';
                this.failureCount = 0;
                this.successCount = 0;
                this.openCycles = 0;
                this.currentProbeTimeout = this.resetTimeout;
                Logger.info(`[circuit-breaker:${this.name}] Circuit CLOSED — service healthy`);
                this.syncRedis();
            }
        }
        else if (this.state === 'CLOSED') {
            this.failureCount = 0;
        }
    }
    /** Record a failed request */
    recordFailure() {
        if (this.state === 'HALF_OPEN') {
            this.probing = false;
            this.state = 'OPEN';
            this.successCount = 0;
            this.openCycles += 1;
            this.currentProbeTimeout = this.nextProbeTimeout();
            this.openedAt = Date.now();
            Logger.warn(`[circuit-breaker:${this.name}] Circuit OPEN — half-open probe failed (probe wait ${this.currentProbeTimeout}ms)`);
            this.notifyCircuitOpen('half-open probe failed');
            this.syncRedis();
        }
        else if (this.state === 'CLOSED') {
            this.failureCount++;
            if (this.failureCount >= this.failureThreshold) {
                this.state = 'OPEN';
                this.openCycles = Math.max(1, this.openCycles + 1);
                this.currentProbeTimeout =
                    this.openCycles <= 1 ? this.resetTimeout : this.nextProbeTimeout();
                this.openedAt = Date.now();
                Logger.warn(`[circuit-breaker:${this.name}] Circuit OPEN — ${this.failureCount} consecutive failures (probe wait ${this.currentProbeTimeout}ms)`);
                this.notifyCircuitOpen(`${this.failureCount} consecutive failures`);
                this.syncRedis();
            }
        }
    }
    getState() {
        return this.state;
    }
    getStats() {
        return {
            state: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
        };
    }
    /** Force circuit open (incident isolation). */
    forceOpen(reason) {
        this.state = 'OPEN';
        this.openedAt = Date.now();
        this.failureCount = this.failureThreshold;
        Logger.warn(`[circuit-breaker:${this.name}] Circuit force-opened${reason ? `: ${reason}` : ''}`);
        this.notifyCircuitOpen(reason || 'force-opened');
        this.syncRedis();
    }
    notifyCircuitOpen(detail) {
        void import('../alerting/webhook-alerter.js').then(({ sendAlert }) => sendAlert({
            severity: 'warning',
            title: `Circuit open: ${this.name}`,
            message: detail,
            serverName: this.name,
        })).catch(() => undefined);
    }
    syncRedis() {
        void saveCircuitToRedis(this.name, {
            state: this.state,
            failureCount: this.failureCount,
            openedAt: this.openedAt,
        });
    }
    /** Hydrate from Redis snapshot (multi-replica). */
    applyRedisSnapshot(snap) {
        this.state = snap.state;
        this.failureCount = snap.failureCount;
        this.openedAt = snap.openedAt;
    }
}
//# sourceMappingURL=circuit-breaker.js.map