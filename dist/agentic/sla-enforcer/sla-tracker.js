/** #7 SLA Enforcement & Circuit Breaker Intelligence */
import { Logger } from '../../utils/logger.js';
export class SlaEnforcer {
    metrics = new Map();
    circuitState = new Map();
    config = { maxLatencyP95: 2000, maxErrorRate: 0.05, windowMinutes: 5 };
    record(serverName, toolName, latencyMs, success) {
        const key = `${serverName}:${toolName}`;
        if (!this.metrics.has(key))
            this.metrics.set(key, { latencies: [], errors: 0, total: 0 });
        const m = this.metrics.get(key);
        m.latencies.push(latencyMs);
        if (!success)
            m.errors++;
        m.total++;
        if (m.latencies.length > 1000)
            m.latencies = m.latencies.slice(-1000);
    }
    check(serverName, toolName) {
        const key = `${serverName}:${toolName}`;
        const m = this.metrics.get(key);
        if (!m)
            return { serverName, toolName, latencyP50: 0, latencyP95: 0, errorRate: 0, breaches: [], circuitState: 'closed' };
        const sorted = [...m.latencies].sort((a, b) => a - b);
        const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
        const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
        const errorRate = m.total > 0 ? m.errors / m.total : 0;
        const breaches = [];
        const now = new Date().toISOString();
        if (p95 > this.config.maxLatencyP95)
            breaches.push({ timestamp: now, metric: 'latencyP95', value: p95, threshold: this.config.maxLatencyP95 });
        if (errorRate > this.config.maxErrorRate)
            breaches.push({ timestamp: now, metric: 'errorRate', value: errorRate, threshold: this.config.maxErrorRate });
        let circuit = this.circuitState.get(key) || 'closed';
        if (breaches.length >= 2 && circuit === 'closed') {
            circuit = 'open';
            Logger.warn(`[SlaEnforcer] Circuit OPEN for ${key}: p95=${p95}ms, errors=${(errorRate * 100).toFixed(1)}%`);
        }
        else if (breaches.length === 0 && circuit === 'open')
            circuit = 'half-open';
        this.circuitState.set(key, circuit);
        return { serverName, toolName, latencyP50: p50, latencyP95: p95, errorRate: Math.round(errorRate * 10000) / 100, breaches, circuitState: circuit };
    }
    getStats() { return { totalTools: this.metrics.size, openCircuits: [...this.circuitState.values()].filter(s => s === 'open').length }; }
}
//# sourceMappingURL=sla-tracker.js.map