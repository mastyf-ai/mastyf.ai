# Observability & SIEM Integration

mastyf.ai ships with full observability — Prometheus metrics, OpenTelemetry tracing,
and structured audit logging ready for SIEM export.

## Prometheus Metrics

Exposed on port **9090** at `/metrics`. All metrics include `tenant_id` labels.

### Counters

| Metric | Description |
|--------|-------------|
| `mastyf_requests_total` | Total MCP tool call requests |
| `mastyf_blocked_requests_total` | Requests blocked by policy/hooks/semantic |
| `mastyf_attacks_blocked_total` | Attacks blocked (categorized by type) |
| `mastyf_rugpull_detected_total` | OWASP MCP03 rug-pull detections |
| `mastyf_cost_spent_usd_total` | Total USD spent on token consumption |
| `mastyf_auth_failures_total` | Authentication failures |
| `mastyf_instant_learning_events_total` | Auto-learned rule events |

### Gauges

| Metric | Description |
|--------|-------------|
| `mastyf_active_sessions` | Current active sessions |
| `mastyf_active_proxies` | Running proxy instances |
| `mastyf_redis_available` | Redis connectivity (0/1) |
| `mastyf_semantic_llm_online` | Semantic LLM connectivity (0/1) |
| `mastyf_audit_queue_depth` | Pending audit entries |
| `mastyf_alerting_configured` | Alert channels configured (0/1) |
| `mastyf_tracing_configured` | OpenTelemetry enabled (0/1) |

### Histograms

| Metric | Description |
|--------|-------------|
| `mastyf_proxy_latency_ms` | Per-call proxy latency (p50/p95/p99) |
| `mastyf_auth_latency_ms` | Authentication latency |
| `mastyf_request_duration_seconds` | Full request lifecycle |
| `mastyf_token_cost_usd` | Per-call token cost |
| `mastyf_semantic_scan_duration_seconds` | Semantic scan time |

### Grafana Dashboard

Import `docs/grafana-dashboard.json` for a pre-built mastyf dashboard with:
- Block rate over time
- Per-server attack breakdown
- Fleet health (heartbeat gap, version skew)
- Token spend by tenant
- Rug-pull detection timeline

## OpenTelemetry Tracing

Every MCP tool call is traced across all 5 transports (stdio, SSE, HTTP, WebSocket, Streamable HTTP).
W3C trace context is propagated through upstream and downstream calls.

### Configuration

```bash
export OTEL_SERVICE_NAME=mastyf-proxy
export OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318/v1/traces
export OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,tenant.id=default

# Start proxy — tracing auto-initializes
node dist/cli.js start
```

### Supported Backends

| Backend | Endpoint env | Notes |
|---------|-------------|-------|
| Jaeger | `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318/v1/traces` | Default OTLP HTTP exporter |
| Zipkin | `OTEL_EXPORTER_ZIPKIN_ENDPOINT=http://zipkin:9411/api/v2/spans` | Alternative exporter |
| Datadog | `OTEL_EXPORTER_OTLP_ENDPOINT` + DD API key | Via OTLP HTTP |
| Grafana Tempo | `OTEL_EXPORTER_OTLP_ENDPOINT` | Native OTLP |
| Honeycomb | `OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=$KEY` | Via OTLP headers |
| New Relic | `OTEL_EXPORTER_OTLP_ENDPOINT` + NR license key | Via OTLP |

### Span Attributes

Each tool call span includes:
- `tool.name` — the MCP tool name
- `server.name` — the upstream MCP server name
- `policy.decision` — `block` or `pass`
- `policy.rule` — the rule that fired (if blocked)
- `policy.phase` — which defense phase caught it
- `tenant.id` — multi-tenant identifier
- `request.id` — unique request UUID

## SIEM Export

mastyf writes structured audit logs to `~/.mastyf-ai/tenants/{tenantId}/policy-audit.jsonl`.
These can be exported to SIEM-compatible formats.

### Export Script

```bash
# Export as CEF (ArcSight)
pnpm enterprise:siem --format cef --output /var/log/mastyf-cef.log

# Export as LEEF (QRadar)
pnpm enterprise:siem --format leef --output /var/log/mastyf-leef.log

# Export as raw JSONL
pnpm enterprise:siem --format jsonl --output /var/log/mastyf-audit.jsonl
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MASTYF_AI_SIEM_EXPORT_ENABLED` | `false` | Enable periodic SIEM export |
| `MASTYF_AI_SIEM_EXPORT_FORMAT` | `jsonl` | Format: `cef`, `leef`, or `jsonl` |
| `MASTYF_AI_SIEM_EXPORT_INTERVAL_SEC` | `300` | Export interval in seconds |
| `MASTYF_AI_SIEM_EXPORT_PATH` | `~/.mastyf-ai/exports/` | Export directory |

### CEF Format Example

```
CEF:0|mastyf.ai|MCP Proxy|4.2.0|BLOCK|Prompt Injection|5|msg=Blocked by MCP Mastyf AI
suser=admin src=127.0.0.1 dhost=filesystem request=/tools/call
cs1Label=rule cs1=ignore-instructions
cs2Label=tool cs2=search
cs3Label=phase cs3=policy
```

### LEEF Format Example

```
LEEF:2.0|mastyf.ai|MCP Proxy|4.2.0|BLOCK|devTime=2026-07-23T10:00:00Z
src=127.0.0.1 usrName=admin
url=/tools/call
rule=ignore-instructions
sev=5
msg=Blocked by MCP Mastyf AI: Prompt injection in tool arguments
```

## Self-Hosted Log Shipping

For environments without direct SIEM integration, use any log shipper:

### Filebeat (Elastic)
```yaml
filebeat.inputs:
  - type: log
    enabled: true
    paths:
      - /root/.mastyf-ai/tenants/*/policy-audit.jsonl
    json.keys_under_root: true
    json.add_error_key: true
```

### Fluentd
```xml
<source>
  @type tail
  path /root/.mastyf-ai/tenants/*/policy-audit.jsonl
  pos_file /var/log/td-agent/mastyf-audit.pos
  tag mastyf.audit
  <parse>
    @type json
  </parse>
</source>
```

### Vector
```toml
[sources.mastyf_audit]
type = "file"
include = ["/root/.mastyf-ai/tenants/*/policy-audit.jsonl"]

[sinks.elasticsearch]
type = "elasticsearch"
inputs = ["mastyf_audit"]
endpoint = "http://elasticsearch:9200"
```
