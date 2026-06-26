# Enterprise Deployment Guide

Production deployment for MCP Mastyf AI using Helm overlays, signed policy governance, and observability bundles.

## Helm overlays

```bash
helm upgrade --install mastyf-ai ./deploy/helm/mastyf-ai \
  -f deploy/helm/mastyf-ai/values.yaml \
  -f deploy/helm/mastyf-ai/values-enterprise.yaml \
  --set gateway.ingress.host=mastyf.example.com \
  --set secrets.existingSecret=mastyf-ai-secret
```

| Overlay | Purpose |
|---------|---------|
| `values.yaml` | Baseline single-replica dev/staging |
| `values-enterprise.yaml` | Production: 3 replicas, TLS ingress, mTLS upstream, SIEM, Redis required |
| `values-ha.yaml` | Multi-replica SQLite guard + Postgres enforcement |

## Signed policy governance

1. Export and sign policy: `node scripts/sign-policy.mjs default-policy.yaml`
2. Mount signed YAML + `.sig.json` via ConfigMap or ExternalSecrets
3. Enable `MASTYF_AI_STRICT_MODE=true` — unsigned policy changes are rejected at reload

## Four-eyes policy updates

Threat Lab and dashboard policy PUT require operator+ role. Production merges use PR + signed artifact; autopilot shadow→enforce stages require human approval (see `docs/compliance/EU_AI_ACT.md`).

## Environment matrix (enterprise)

| Variable | Required | Description |
|----------|----------|-------------|
| `REDIS_URL` | Yes (multi-replica) | Session flow, rate limits, policy cache |
| `DATABASE_URL` | Yes | Postgres via PgBouncer `:6432` |
| `POLICY_AUDIT_ENABLED` | Yes | Policy decision audit trail |
| `MASTYF_AI_SIEM_SPLUNK_ENABLED` | One SIEM | Splunk HEC export |
| `MASTYF_AI_AUDIT_HASH_CHAIN` | Recommended | Tamper-evident audit chain |
| `MASTYF_AI_GLOBAL_RATE_LIMIT_REQUIRED` | Yes | Fail startup without Redis |
| `MASTYF_AI_AUTH_REQUIRED` | Gateway | OAuth on all ingress when multi-tenant |
| `LOG_LEVEL` | Recommended | Structured JSON log level (`info`, `warn`, `error`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Tracing | OTLP HTTP collector URL (e.g. `http://otel-collector:4318`) |
| `OTEL_SERVICE_NAME` | Tracing | Trace service name (default `mastyf-ai`) |
| `OTEL_ENABLED` | Tracing | Set `false` to disable tracing while endpoint is set |
| `METRICS_ENABLED` | Monitoring | Expose `/metrics` on `METRICS_PORT` (default 9090) |
| `ALERT_SLACK_WEBHOOK` | Alerting | Slack incoming webhook (policy blocks, incidents, circuit opens) |
| `ALERT_PAGERDUTY_KEY` | Alerting | PagerDuty Events API v2 routing key |
| `ALERT_MIN_SEVERITY` | Alerting | Minimum severity for webhook delivery (`warning`, `high`, `critical`) |
| `MASTYF_AI_ALERTING_REQUIRED` | Alerting | Fail startup when no app alert destinations (enterprise default `true`) |
| `MASTYF_AI_CLUSTER_ALERTING_ONLY` | Alerting | Optional: skip app webhook requirement when Alertmanager handles all routing |
| `MASTYF_AI_SEMANTIC_STRICT` | Security | Fail-closed when semantic LLM unavailable (core + proxy) |
| `MASTYF_AI_SCAN_TOOL_TIMEOUT_MAX_MS` | Performance | Cap per-tool corpus scan timeout (default 15000) |
| `MASTYF_AI_MAX_ARGUMENT_BYTES` | Security | Core scanner argument size cap (default 10MB) |
| `MASTYF_AI_LOOP_BURST_MAX_SIMILAR` | Cost control | Similar tool-call burst threshold (default 8 / 10s) |
| `MASTYF_AI_DB_ENCRYPTION_KEY` | Compliance | Field-level encryption at rest for audit DB |

### Semantic profiles (balanced vs max-security)

Set `MASTYF_AI_SEMANTIC_PROFILE=balanced|max-security` or use Helm overlays `values-balanced.yaml` / `values-enterprise.yaml`.

| Setting | Balanced | Max-security (enterprise) |
|---------|----------|---------------------------|
| `MASTYF_AI_SEMANTIC_STRICT` | `false` | `true` |
| `MASTYF_AI_SEMANTIC_SYNC_REQUEST_LLM` | `false` | `true` |
| `MASTYF_AI_CORE_SEMANTIC_FAIL_CLOSED` | `false` | `true` |
| `MASTYF_AI_SEMANTIC_ASYNC` | `true` | `true` |
| Hot-path block P99 target | Policy + local semantic ~50–100ms | Sync LLM gate ≤ 2500ms |
| Async audit timeout metric | `mastyf_ai_semantic_async_timeout_total` | Same |

### Max-security semantic SLO (enterprise)

Enterprise Helm sets `MASTYF_AI_SEMANTIC_STRICT=true`, `MASTYF_AI_SEMANTIC_SYNC_REQUEST_LLM=true`, and `MASTYF_AI_CORE_SEMANTIC_FAIL_CLOSED=true`. Sync request semantic scans are **bounded by design** (not sub-millisecond hot-path latency):

| Metric | Target | Notes |
|--------|--------|-------|
| Sync request semantic P99 | ≤ `MASTYF_AI_SEMANTIC_SYNC_REQUEST_TIMEOUT_MS` (default 2500ms) | Histogram: `mastyf_ai_semantic_scan_duration_seconds{phase="sync_request"}` |
| Async audit P99 | ≤ semantic LLM timeout | Histogram: `phase="async_audit"` |
| Fail-closed on LLM outage | Required in enterprise | Blocks when strict + LLM unavailable |

Prometheus alert `MastyfAiTenantSpendNearCap` fires when `mastyf_ai_tenant_spend_usd_day_ratio > 0.9`.

## Structured logging and trace correlation

Proxy mode emits JSON logs on **stderr** (stdout is reserved for MCP JSON-RPC). Each log line includes `requestId` where applicable; when OpenTelemetry is active, logs also include `trace_id` and `span_id` from the active span.

```bash
export LOG_LEVEL=info
export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
export OTEL_SERVICE_NAME=mastyf-ai
```

## Prometheus Operator

1. Install Prometheus Operator (kube-prometheus-stack or standalone)
2. Enable `monitoring.serviceMonitor.enabled: true` and `monitoring.prometheusRule.enabled: true`
3. Import Grafana dashboards from ConfigMap `*-grafana-dashboard` (label `grafana_dashboard: "1"`)

Example PromQL:

```promql
sum(rate(mastyf_ai_requests_total{decision="block"}[5m]))
/ sum(rate(mastyf_ai_requests_total[5m]))
```

## Real-time dashboards

| Surface | Use case |
|---------|----------|
| In-app WebSocket dashboard (`DASHBOARD_ENABLED=true`) | Live operator view: audit trail, blocks, swarm status |
| Grafana (Helm `monitoring.grafanaDashboard.enabled`) | Cluster SRE view: PromQL, SLO panels, alert correlation |

## OpenTelemetry / Jaeger

Set in enterprise overlay:

```yaml
monitoring:
  otel:
    enabled: true
    endpoint: http://otel-collector.observability:4318
    deployCollector: true   # optional in-cluster collector (namespace observability)
    exportEndpoint: ""      # optional second-hop (Tempo/Jaeger/Grafana Cloud)
```

Proxy transports propagate W3C `traceparent` to upstream MCP servers on HTTP, SSE, streamable HTTP, WebSocket, and stdio tool calls. Structured logs include `trace_id` / `span_id` when a span is active. Prometheus gauge `mastyf_ai_tracing_configured` reports whether OTLP export is live.

Local Jaeger:

```yaml
# docker-compose snippet
otel-collector:
  image: otel/opentelemetry-collector-contrib:latest
  ports: ["4318:4318"]
jaeger:
  image: jaegertracing/all-in-one:latest
  ports: ["16686:16686"]
```

## Alerting (Slack / PagerDuty)

Enterprise overlay enables **app-level** and **cluster-level** alerting:

| Layer | Mechanism | Configuration |
|-------|-----------|---------------|
| Application | `notifyToolBlock`, circuit-breaker webhooks, incident-responder | `ALERT_SLACK_WEBHOOK`, `ALERT_PAGERDUTY_KEY` via pod secret (`envFrom`) |
| Prometheus | `PrometheusRule` (`MastyfAiHighBlockRate`, `MastyfAiRedisDown`, …) | `monitoring.prometheusRule.enabled: true` |
| Alertmanager | `AlertmanagerConfig` routes critical → PagerDuty, warning → Slack | `monitoring.alertmanager.enabled: true` |

**Vault / ExternalSecrets paths** (see [`externalsecret.yaml`](../deploy/helm/mastyf-ai/templates/externalsecret.yaml)):

- `{path}/alert-slack-webhook` → `ALERT_SLACK_WEBHOOK`
- `{path}/alert-pagerduty-key` → `ALERT_PAGERDUTY_KEY`

**kube-prometheus-stack:** set Alertmanager `alertmanagerConfigSelector` to match Helm label `alertmanagerConfig: mastyf-ai` (default in `values-enterprise.yaml`).

Prometheus gauge `mastyf_ai_alerting_configured` is `1` when app webhooks are configured.

Runbook: [incident-response.md](./runbooks/incident-response.md)

## Production checklist

- [ ] Postgres + PgBouncer (not direct `:5432`)
- [ ] Redis Sentinel or cluster for HA
- [ ] Ingress TLS + upstream mTLS secrets mounted
- [ ] ExternalSecrets for SIEM tokens, dashboard keys, and alert webhooks (`ALERT_SLACK_WEBHOOK`, `ALERT_PAGERDUTY_KEY`)
- [ ] PrometheusRule alerts routed via AlertmanagerConfig or centralized Alertmanager
- [ ] `OTEL_EXPORTER_OTLP_ENDPOINT` pointed at collector (in-cluster `deployCollector` or external)
- [ ] Backup CronJob PVC + optional S3 bucket
- [ ] `mastyf-ai doctor --validate-policy` passes in strict mode

See also: [REDIS_HA.md](./REDIS_HA.md), [DISASTER_RECOVERY.md](./DISASTER_RECOVERY.md), [ENTERPRISE_EVIDENCE_PACK.md](./ENTERPRISE_EVIDENCE_PACK.md).
