import { createServer, type Server } from 'http';
import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';
import { Logger } from './logger.js';
import { DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';

export const registry = new Registry();

/** Attach tenant_id label for multi-tenant Prometheus dashboards. */
export function withTenantMetricLabels(
  labels: Record<string, string>,
  tenantId?: string,
): Record<string, string> {
  return { ...labels, tenant_id: tenantId?.trim() || DEFAULT_TENANT_ID };
}

let defaultMetricsRegistered = false;
let metricsHttpServer: Server | null = null;
let metricsMaintenanceInterval: ReturnType<typeof setInterval> | null = null;
let readinessCheckRef: WeakRef<() => Promise<unknown>> | null = null;

// P3 Fix 12: Prometheus naming convention compliance (_total suffix, HELP strings)
export const requestsTotal = new Counter({
  name: 'mastyf_ai_requests_total',
  help: 'Total number of tools/call requests proxied',
  labelNames: ['server_name', 'decision', 'authn_success', 'tenant_id'],
  registers: [registry],
});

export const blockedRequestsTotal = new Counter({
  name: 'mastyf_ai_blocked_total',
  help: 'Total number of tools/call requests blocked by policy',
  labelNames: ['server_name', 'block_reason', 'rule', 'tenant_id'],
  registers: [registry],
});

export const rugpullDetectedTotal = new Counter({
  name: 'mastyf_ai_rugpull_detected_total',
  help: 'Tool list fingerprint mismatches (OWASP MCP03 rug-pull)',
  labelNames: ['server_name', 'tenant_id'],
  registers: [registry],
});

export const proxyInflightRejectedTotal = new Counter({
  name: 'mastyf_ai_proxy_inflight_rejected_total',
  help: 'tools/call rejected because proxy max in-flight limit was reached',
  labelNames: ['server_name', 'tenant_id'],
  registers: [registry],
});

export const semanticSyncRequestBlocksTotal = new Counter({
  name: 'mastyf_ai_semantic_sync_request_blocks_total',
  help: 'tools/call blocked by enterprise sync semantic request gate',
  labelNames: ['server_name', 'tenant_id'],
  registers: [registry],
});

export const semanticAsyncTimeoutTotal = new Counter({
  name: 'mastyf_ai_semantic_async_timeout_total',
  help: 'Async semantic audit LLM timeouts (off hot path)',
  labelNames: ['label'],
  registers: [registry],
});

export const policyCacheHitsTotal = new Counter({
  name: 'mastyf_ai_policy_cache_hits_total',
  help: 'Policy evaluation cache hits',
  labelNames: ['tenant_id', 'allowed'],
  registers: [registry],
});

export const sessionFlowBackend = new Gauge({
  name: 'mastyf_ai_session_flow_backend',
  help: 'Session flow store backend (1=redis, 0=memory)',
  registers: [registry],
});

export const attacksBlockedTotal = new Counter({
  name: 'mastyf_ai_attacks_blocked_total',
  help: 'Policy blocks by attack category and rule',
  labelNames: ['category', 'rule', 'tenant_id'],
  registers: [registry],
});

export const costSpentUsdTotal = new Counter({
  name: 'mastyf_ai_cost_spent_usd',
  help: 'Cumulative estimated USD spend from proxied calls',
  labelNames: ['tenant_id'],
  registers: [registry],
});

/** Record attack block with category label for enterprise dashboards. */
export function recordAttackBlocked(
  rule: string,
  tenantId?: string,
  category = 'policy',
): void {
  attacksBlockedTotal.inc(
    withTenantMetricLabels({ category, rule: rule || 'unknown' }, tenantId),
  );
}

/** Increment blocked request counter and attack-by-category metric together. */
export function recordProxyBlock(
  labels: {
    server_name: string;
    block_reason: string;
    rule: string;
    tenant_id?: string;
  },
  category = 'policy',
): void {
  blockedRequestsTotal.inc(
    withTenantMetricLabels(
      {
        server_name: labels.server_name,
        block_reason: labels.block_reason,
        rule: labels.rule,
      },
      labels.tenant_id,
    ),
  );
  recordAttackBlocked(labels.rule, labels.tenant_id, category);
}

export function recordCostSpendUsd(amount: number, tenantId?: string): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  costSpentUsdTotal.inc(withTenantMetricLabels({}, tenantId), amount);
}

export const injectionDetectedTotal = new Counter({
  name: 'mastyf_ai_injection_detected_total',
  help: 'Total number of prompt injection attempts detected',
  labelNames: ['server_name', 'severity'],
  registers: [registry],
});

export const authFailuresTotal = new Counter({
  name: 'mastyf_ai_auth_failures_total',
  help: 'Total number of authentication failures',
  labelNames: ['server_name', 'reason'],
  registers: [registry],
});

export const circuitBreakerState = new Gauge({
  name: 'mastyf_ai_circuit_breaker_state',
  help: 'Circuit breaker state (0=CLOSED, 1=OPEN, 2=HALF_OPEN)',
  labelNames: ['server_name'],
  registers: [registry],
});

export const circuitBreakerSyncTotal = new Counter({
  name: 'mastyf_ai_circuit_breaker_sync_total',
  help: 'Redis circuit breaker sync operations',
  labelNames: ['op', 'result'],
  registers: [registry],
});

export const activeSessions = new Gauge({
  name: 'mastyf_ai_active_sessions',
  help: 'Number of active session tokens',
  registers: [registry],
});

export const activeProxies = new Gauge({
  name: 'mastyf_ai_active_proxies',
  help: 'Number of active proxy connections',
  registers: [registry],
});

export const sseUntrackedServers = new Gauge({
  name: 'mastyf_ai_sse_untracked_servers',
  help: 'SSE/HTTP MCP servers configured without stdio proxy path (audit/cost may be incomplete)',
  labelNames: ['server_name'],
  registers: [registry],
});

export const proxyLatencyMs = new Histogram({
  name: 'mastyf_ai_proxy_latency_ms',
  help: 'Proxy processing latency in milliseconds',
  labelNames: ['server_name', 'tenant_id'],
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
  registers: [registry],
});

export const authLatencyMs = new Histogram({
  name: 'mastyf_ai_auth_latency_ms',
  help: 'Authentication/JWT validation latency in milliseconds',
  labelNames: ['server_name'],
  buckets: [1, 5, 10, 25, 50, 100, 250, 500],
  registers: [registry],
});

export const requestDurationSeconds = new Histogram({
  name: 'mastyf_ai_request_duration_seconds',
  help: 'Duration of proxied tools/call requests in seconds',
  labelNames: ['server_name', 'decision'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const tokenCostUsd = new Histogram({
  name: 'mastyf_ai_token_cost_usd',
  help: 'Estimated USD cost per tools/call request',
  labelNames: ['server_name', 'model'],
  buckets: [0.00001, 0.0001, 0.001, 0.01, 0.1, 1],
  registers: [registry],
});

export const instantLearningEventsTotal = new Counter({
  name: 'mastyf_ai_instant_learning_events_total',
  help: 'Per-block instant attack learning events processed',
  labelNames: ['block_rule', 'outcome'],
  registers: [registry],
});

export const suggestionQueueDepth = new Gauge({
  name: 'mastyf_ai_suggestion_queue_depth',
  help: 'Pending AI policy suggestions awaiting operator review',
  labelNames: ['tenant_id'],
  registers: [registry],
});

export const redisAvailable = new Gauge({
  name: 'mastyf_ai_redis_available',
  help: 'Redis connectivity for distributed rate limits and sessions (1=up, 0=down)',
  registers: [registry],
});

export const semanticLlmOnline = new Gauge({
  name: 'mastyf_ai_semantic_llm_online',
  help: 'Semantic LLM layer availability (1=online, 0=offline)',
  registers: [registry],
});

export const loopBlocksTotal = new Counter({
  name: 'mastyf_ai_loop_blocks_total',
  help: 'Policy blocks from loop / perturbation anomaly guard',
  labelNames: ['rule', 'tenant_id'],
  registers: [registry],
});

export const auditQueueDepth = new Gauge({
  name: 'mastyf_ai_audit_queue_depth',
  help: 'Async semantic audit / SIEM export queue depth',
  registers: [registry],
});

export const alertingConfigured = new Gauge({
  name: 'mastyf_ai_alerting_configured',
  help: 'App-level alert webhooks configured (1=yes, 0=no)',
  registers: [registry],
});

export const tracingConfigured = new Gauge({
  name: 'mastyf_ai_tracing_configured',
  help: 'OpenTelemetry OTLP tracing active (1=yes, 0=no)',
  registers: [registry],
});

export const semanticScanDurationSeconds = new Histogram({
  name: 'mastyf_ai_semantic_scan_duration_seconds',
  help: 'Semantic scan duration by phase',
  labelNames: ['phase', 'outcome'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15],
  registers: [registry],
});

export const tenantSpendUsdDayRatio = new Gauge({
  name: 'mastyf_ai_tenant_spend_usd_day_ratio',
  help: 'Tenant daily USD spend as fraction of cap (0-1)',
  registers: [registry],
});

export const tenantTokensPerMin = new Gauge({
  name: 'mastyf_ai_tenant_tokens_per_min',
  help: 'Recent tenant token rate (rolling window)',
  labelNames: ['tenant_id'],
  registers: [registry],
});

export function recordSemanticScanDuration(phase: string, durationMs: number, outcome: string): void {
  semanticScanDurationSeconds.observe({ phase, outcome }, Math.max(0, durationMs) / 1000);
}

/** Update suggestion queue depth from pending suggestions file or engine state. */
export function setSuggestionQueueDepth(count: number, tenantId?: string): void {
  suggestionQueueDepth.set(withTenantMetricLabels({}, tenantId), Math.max(0, count));
}

function ensureDefaultMetrics(): void {
  if (defaultMetricsRegistered) return;
  collectDefaultMetrics({ register: registry, prefix: 'mastyf_ai_' });
  defaultMetricsRegistered = true;
}

function startMetricsMaintenance(intervalMs: number): void {
  if (metricsMaintenanceInterval) return;
  metricsMaintenanceInterval = setInterval(() => {
    void registry.metrics().catch(() => {});
    void import('./observability-gauges.js').then(({ refreshObservabilityGauges }) =>
      refreshObservabilityGauges(),
    ).catch(() => {});
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

  try {
    const { setSemanticScanDurationHook } = await import(
      '../../packages/core/dist/semantic-duration-hook.js'
    );
    setSemanticScanDurationHook((phase: string, durationMs: number, outcome: string) => {
      recordSemanticScanDuration(phase, durationMs, outcome);
    });
  } catch {
    // core hook optional in slim builds
  }

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
      const metricsToken = process.env['METRICS_BEARER_TOKEN']?.trim()
        || process.env['MASTYF_AI_METRICS_BEARER_TOKEN']?.trim();

      if (url === '/metrics' && metricsToken) {
        const auth = req.headers.authorization || '';
        const expected = `Bearer ${metricsToken}`;
        if (auth !== expected) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }
      }

      if (url === '/healthz') {
        const { getSemanticRequestGateStatus } = await import('../ai/sync-semantic-request.js');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ok',
            uptime: process.uptime(),
            ...getSemanticRequestGateStatus(),
          }),
        );
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
