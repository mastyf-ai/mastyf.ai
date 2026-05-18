import { createServer, type Server } from 'http';
import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';
import { Logger } from './logger.js';

export const registry = new Registry();

let defaultMetricsRegistered = false;
let metricsHttpServer: Server | null = null;
let metricsMaintenanceInterval: ReturnType<typeof setInterval> | null = null;
let readinessCheckRef: WeakRef<() => Promise<unknown>> | null = null;

// P3 Fix 12: Prometheus naming convention compliance (_total suffix, HELP strings)
export const requestsTotal = new Counter({
  name: 'mcp_guardian_requests_total',
  help: 'Total number of tools/call requests proxied',
  labelNames: ['server_name', 'decision', 'authn_success'],
  registers: [registry],
});

export const blockedRequestsTotal = new Counter({
  name: 'mcp_guardian_blocked_total',
  help: 'Total number of tools/call requests blocked by policy',
  labelNames: ['server_name', 'block_reason', 'rule'],
  registers: [registry],
});

export const injectionDetectedTotal = new Counter({
  name: 'mcp_guardian_injection_detected_total',
  help: 'Total number of prompt injection attempts detected',
  labelNames: ['server_name', 'severity'],
  registers: [registry],
});

export const authFailuresTotal = new Counter({
  name: 'mcp_guardian_auth_failures_total',
  help: 'Total number of authentication failures',
  labelNames: ['server_name', 'reason'],
  registers: [registry],
});

export const circuitBreakerState = new Gauge({
  name: 'mcp_guardian_circuit_breaker_state',
  help: 'Circuit breaker state (0=CLOSED, 1=OPEN, 2=HALF_OPEN)',
  labelNames: ['server_name'],
  registers: [registry],
});

export const activeSessions = new Gauge({
  name: 'mcp_guardian_active_sessions',
  help: 'Number of active session tokens',
  registers: [registry],
});

export const activeProxies = new Gauge({
  name: 'mcp_guardian_active_proxies',
  help: 'Number of active proxy connections',
  registers: [registry],
});

export const sseUntrackedServers = new Gauge({
  name: 'mcp_guardian_sse_untracked_servers',
  help: 'SSE/HTTP MCP servers configured without stdio proxy path (audit/cost may be incomplete)',
  labelNames: ['server_name'],
  registers: [registry],
});

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

export const requestDurationSeconds = new Histogram({
  name: 'mcp_guardian_request_duration_seconds',
  help: 'Duration of proxied tools/call requests in seconds',
  labelNames: ['server_name', 'decision'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const tokenCostUsd = new Histogram({
  name: 'mcp_guardian_token_cost_usd',
  help: 'Estimated USD cost per tools/call request',
  labelNames: ['server_name', 'model'],
  buckets: [0.00001, 0.0001, 0.001, 0.01, 0.1, 1],
  registers: [registry],
});

export const instantLearningEventsTotal = new Counter({
  name: 'mcp_guardian_instant_learning_events_total',
  help: 'Per-block instant attack learning events processed',
  labelNames: ['block_rule', 'outcome'],
  registers: [registry],
});

function ensureDefaultMetrics(): void {
  if (defaultMetricsRegistered) return;
  collectDefaultMetrics({ register: registry, prefix: 'mcp_guardian_' });
  defaultMetricsRegistered = true;
}

function startMetricsMaintenance(intervalMs: number): void {
  if (metricsMaintenanceInterval) return;
  metricsMaintenanceInterval = setInterval(() => {
    void registry.metrics().catch(() => {});
  }, intervalMs);
  metricsMaintenanceInterval.unref?.();
}

function stopMetricsMaintenance(): void {
  if (metricsMaintenanceInterval) {
    clearInterval(metricsMaintenanceInterval);
    metricsMaintenanceInterval = null;
  }
}

/** Release Prometheus HTTP server, maintenance timers, and registry listeners. */
export async function shutdownMetrics(): Promise<void> {
  stopMetricsMaintenance();
  readinessCheckRef = null;

  if (metricsHttpServer) {
    await new Promise<void>((resolve) => {
      metricsHttpServer!.close(() => resolve());
    });
    metricsHttpServer.removeAllListeners();
    metricsHttpServer = null;
  }

  try {
    registry.clear();
  } catch {
    /* registry may already be empty */
  }
}

/** Alias for shutdownMetrics (IDE lifecycle hooks). */
export const dispose = shutdownMetrics;

type ReadinessResult = Awaited<ReturnType<typeof import('./readiness.js').runReadinessChecks>>;

async function runReadinessViaRef(): Promise<ReadinessResult> {
  const { runReadinessChecks } = await import('./readiness.js');
  readinessCheckRef = new WeakRef(runReadinessChecks);
  return runReadinessChecks();
}

// ── Metrics server ──
export async function startMetricsServer(port: number = 9090): Promise<Registry> {
  ensureDefaultMetrics();

  if (process.env['METRICS_ENABLED'] !== 'true') {
    Logger.debug('[metrics] Metrics server not enabled (set METRICS_ENABLED=true)');
    return registry;
  }

  const maintenanceMs = parseInt(process.env['METRICS_MAINTENANCE_INTERVAL_MS'] || '60000', 10);
  if (Number.isFinite(maintenanceMs) && maintenanceMs > 0) {
    startMetricsMaintenance(maintenanceMs);
  }

  if (metricsHttpServer) {
    return registry;
  }

  try {
    const server = createServer(async (req, res) => {
      const url = req.url || '/metrics';
      if (url === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
        return;
      }
      if (url === '/readyz') {
        const run = readinessCheckRef?.deref() as (() => Promise<ReadinessResult>) | undefined;
        const result: ReadinessResult = run ? await run() : await runReadinessViaRef();
        res.writeHead(result.ready ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: result.ready ? 'ready' : 'not_ready', checks: result.checks }));
        return;
      }
      res.writeHead(200, { 'Content-Type': registry.contentType });
      res.end(await registry.metrics());
    });
    server.listen(port, () => {
      Logger.info(`[metrics] Prometheus at http://0.0.0.0:${port}/metrics (health: /healthz, /readyz)`);
    });
    metricsHttpServer = server;
    return registry;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    Logger.error(`[metrics] Failed to start: ${msg}`);
    return registry;
  }
}

/** @internal Test hook — whether maintenance interval is active */
export function isMetricsMaintenanceActive(): boolean {
  return metricsMaintenanceInterval !== null;
}
