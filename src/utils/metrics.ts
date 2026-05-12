import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';
import { Logger } from './logger.js';

/**
 * Prometheus metrics for MCP Guardian.
 * Exposed at /metrics for scraping by Prometheus/Grafana.
 *
 * Enable with: METRICS_ENABLED=true METRICS_PORT=9090
 */
export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'mcp_guardian_' });

// ── Counters ─────────────────────────────────────────────────────
export const requestsTotal = new Counter({
  name: 'mcp_guardian_requests_total',
  help: 'Total number of tools/call requests processed',
  labelNames: ['server_name', 'decision', 'authn_success'],
  registers: [registry],
});

export const blockedRequestsTotal = new Counter({
  name: 'mcp_guardian_blocked_requests_total',
  help: 'Total number of blocked tools/call requests',
  labelNames: ['server_name', 'block_reason', 'rule'],
  registers: [registry],
});

export const authFailuresTotal = new Counter({
  name: 'mcp_guardian_auth_failures_total',
  help: 'Total number of authentication failures',
  labelNames: ['server_name', 'reason'],
  registers: [registry],
});

// ── Gauges ────────────────────────────────────────────────────────
export const circuitBreakerState = new Gauge({
  name: 'mcp_guardian_circuit_breaker_state',
  help: 'Circuit breaker state: 0=CLOSED, 1=OPEN, 2=HALF_OPEN',
  labelNames: ['server_name'],
  registers: [registry],
});

export const activeSessions = new Gauge({
  name: 'mcp_guardian_active_sessions',
  help: 'Number of active session tokens',
  registers: [registry],
});

// ── Histograms ────────────────────────────────────────────────────
export const proxyLatencyMs = new Histogram({
  name: 'mcp_guardian_proxy_latency_ms',
  help: 'Proxy processing latency in milliseconds',
  labelNames: ['server_name'],
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
  registers: [registry],
});

export const authLatencyMs = new Histogram({
  name: 'mcp_guardian_auth_latency_ms',
  help: 'Authentication/JWT validation latency in milliseconds',
  labelNames: ['server_name'],
  buckets: [1, 5, 10, 25, 50, 100, 250, 500],
  registers: [registry],
});

// ── Metrics server ────────────────────────────────────────────────
export async function startMetricsServer(port: number = 9090): Promise<Registry> {
    if (process.env['METRICS_ENABLED'] !== 'true') {
      Logger.debug('[metrics] Metrics server not enabled (set METRICS_ENABLED=true)');
      return registry;
    }

  try {
    const { createServer } = await import('http');
    const server = createServer(async (req, res) => {
      const url = req.url || '/metrics';

      // GAP 16: /healthz — liveness probe
      if (url === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
        return;
      }

      // GAP 16: /readyz — readiness probe
      if (url === '/readyz') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ready' }));
        return;
      }

      // Default: Prometheus metrics
      res.writeHead(200, { 'Content-Type': registry.contentType });
      res.end(await registry.metrics());
    });
    server.listen(port, () => {
      Logger.info(`[metrics] Prometheus metrics available at http://0.0.0.0:${port}/metrics`);
      Logger.info(`[metrics] Health: http://0.0.0.0:${port}/healthz | Readiness: http://0.0.0.0:${port}/readyz`);
    });
    return registry;
  } catch (err: any) {
    Logger.error(`[metrics] Failed to start metrics server: ${err?.message}`);
    return registry;
  }
}
