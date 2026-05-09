# Production Deployment Guide

This guide covers deploying MCP Guardian in production Kubernetes environments.

## Table of Contents

- [Architecture](#architecture)
- [Quick Start (Helm)](#quick-start-helm)
- [Configuration](#configuration)
- [Fail-Open vs Fail-Closed](#fail-open-vs-fail-closed)
- [Sidecar Injection Pattern](#sidecar-injection-pattern)
- [Scaling Recommendations](#scaling-recommendations)
- [High Availability](#high-availability)
- [Monitoring & Alerting](#monitoring--alerting)
- [Security Hardening](#security-hardening)
- [Disaster Recovery](#disaster-recovery)

---

## Architecture

In production, MCP Guardian runs as a **proxy sidecar** between your AI client and MCP servers:

```
┌──────────────┐     ┌────────────────────┐     ┌──────────────┐
│  AI Client   │────▶│  MCP Guardian      │────▶│  MCP Server  │
│ (Cline/      │     │  (proxy)           │     │  (stdio/SSE) │
│  Claude)     │◀────│  ┌──────────────┐  │◀────│              │
└──────────────┘     │  │Policy Engine │  │     └──────────────┘
                     │  │ ● allowlist │  │
                     │  │ ● blocklist │  │
                     │  │ ● rate lim  │  │
                     │  │ ● token bud │  │
                     │  └──────────────┘  │
                     │  ┌──────────────┐  │
                     │  │SIEM Logger   │──▶ Splunk/Datadog
                     │  │(pino JSON)   │  │
                     │  └──────────────┘  │
                     └────────────────────┘
```

**Key characteristics:**
- MCP Guardian **sits between** the AI client and MCP servers
- Every `tools/call` is intercepted, evaluated, and passed/blocked/flagged
- Policy decisions are logged as structured JSON for SIEM ingestion
- In `block` mode, malicious calls return JSON-RPC errors before reaching MCP servers

---

## Quick Start (Helm)

### Prerequisites

- Kubernetes 1.25+
- Helm 3.12+
- `kubectl` configured for your cluster

### Installation

```bash
# Add the Helm repo (or install from local chart)
helm repo add mcp-guardian https://rudraneel93.github.io/mcp-guardian
helm repo update

# Install with default values
helm install mcp-guardian mcp-guardian/mcp-guardian \
  --set config.mcpConfigPath=/etc/mcp-guardian/cline_mcp_settings.json \
  --set config.policy.mode=block

# Or install from the local source
helm install mcp-guardian ./deploy/helm/mcp-guardian \
  -f my-values.yaml
```

### Verifying the Deployment

```bash
# Check pods are running
kubectl get pods -l app.kubernetes.io/name=mcp-guardian

# Check logs for policy decisions
kubectl logs -l app.kubernetes.io/name=mcp-guardian --tail=50

# Expected output: structured JSON logs with policy_decision events
```

---

## Configuration

### Example `my-values.yaml` for production:

```yaml
replicaCount: 3

config:
  mcpConfigPath: /etc/mcp-guardian/cline_mcp_settings.json
  policy:
    path: /etc/mcp-guardian/policy.yaml
    mode: block                       # audit | warn | block
  env:
    LOG_LEVEL: "info"
    MCP_GUARDIAN_DB_PATH: "/data/mcp-guardian/history.db"
    NVD_API_KEY: "your-nvd-api-key"
  failMode: "fail-closed"             # fail-closed | fail-open

resources:
  requests:
    cpu: 200m
    memory: 256Mi
  limits:
    cpu: 1000m
    memory: 1Gi

persistence:
  enabled: true
  size: 10Gi
  storageClass: "fast-ssd"

service:
  type: ClusterIP
  port: 8080

podSecurityContext:
  runAsNonRoot: true
  runAsUser: 1000

podDisruptionBudget:
  enabled: true
  minAvailable: 2
```

### Key Configuration Options

| Parameter | Default | Description |
|-----------|---------|-------------|
| `config.policy.mode` | `warn` | Policy enforcement: `audit` (passive), `warn` (flag), `block` (enforce) |
| `config.failMode` | `fail-closed` | Behavior on proxy crash: `fail-closed` blocks all traffic, `fail-open` allows |
| `replicaCount` | `2` | Number of proxy replicas for HA |
| `persistence.size` | `1Gi` | PVC size for SQLite database |
| `resources.limits.memory` | `512Mi` | Memory limit — increase for high-traffic deployments |

---

## Fail-Open vs Fail-Closed

MCP Guardian acts as a critical path component. If the proxy goes down, you must decide how traffic flows.

### Fail-Closed (Default — More Secure)

**Behavior:** If the proxy process crashes, all MCP traffic is blocked. The AI client receives no responses.

```
AI Client ──▶ ❌ (no proxy) ──▶ MCP Server
              Traffic blocked
```

**Pros:**
- No un-audited traffic ever reaches MCP servers
- Prevents bypass attacks during proxy restart

**Cons:**
- AI client loses all MCP functionality during outage
- Requires fast recovery (auto-restart, multi-replica)

**Use when:** Security is paramount (PCI, HIPAA, SOC2 environments).

#### Enabling Fail-Closed:

```yaml
config:
  failMode: "fail-closed"
```

The proxy itself doesn't "deny" traffic — if the proxy is dead, the TCP connection breaks, achieving the same result. For stdio-based MCP servers, ensure the proxy is a hard dependency (child process exiting = agent can't communicate).

### Fail-Open (Less Secure, Higher Availability)

**Behavior:** Traffic bypasses MCP Guardian during a restart or crash.

```
AI Client ──▶ MCP Server (direct)
              ┌─────────┐
              │ Warning: │
              │ No audit │
              └─────────┘
```

**Pros:**
- AI client continues working during proxy restart
- Higher operational uptime

**Cons:**
- Un-audited traffic creates a security blind spot
- Violates compliance requirements in regulated industries

**Use when:** Availability is more important than guaranteed audit (e.g., development environments, CI/CD pipelines).

#### Enabling Fail-Open:

```yaml
config:
  failMode: "fail-open"
```

**Implementation for stdio MCP servers:** Run the proxy as an optional sidecar that the AI client connects to. If the proxy is unavailable, the client can fall back to direct connections.

---

## Sidecar Injection Pattern

For stdio-based MCP servers (the most common deployment), MCP Guardian runs as a **sidecar proxy** in the same pod:

### Example: MCP File Server with Guardian Sidecar

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: mcp-filesystem-guarded
spec:
  containers:
    # ── MCP Guardian Proxy (sidecar) ─────────────────────────
    - name: mcp-guardian
      image: node:20-alpine
      command:
        - /bin/sh
        - -c
        - |
          npm install -g @mcp-guardian/server && \
          mcp-guardian proxy \
            --config /etc/mcp-guardian/filesystem-config.json \
            --policy /etc/mcp-guardian/policy.yaml \
            --blocking-mode block
      volumeMounts:
        - name: guardian-config
          mountPath: /etc/mcp-guardian
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000

    # ── MCP File Server (application) ────────────────────────
    - name: mcp-filesystem
      image: node:20-alpine
      command:
        - npx
        - -y
        - @modelcontextprotocol/server-filesystem
        - /data
      volumeMounts:
        - name: data
          mountPath: /data

  volumes:
    - name: guardian-config
      configMap:
        name: mcp-guardian-config
    - name: data
      persistentVolumeClaim:
        claimName: filesystem-data
```

**How it works:**
1. AI client connects to the MCP Guardian proxy (not directly to the MCP server)
2. Proxy evaluates every `tools/call` against the policy engine
3. Safe calls are forwarded to the MCP server
4. Malicious calls are blocked with a JSON-RPC error

---

## Scaling Recommendations

### Resource Allocation

| Traffic Level | CPU Request | CPU Limit | Memory Request | Memory Limit | Replicas |
|---------------|-------------|-----------|----------------|--------------|----------|
| Low (<10 calls/min) | 100m | 500m | 128Mi | 256Mi | 1-2 |
| Medium (10-100 calls/min) | 200m | 1000m | 256Mi | 512Mi | 2-3 |
| High (100-1000 calls/min) | 500m | 2000m | 512Mi | 1Gi | 3-5 |
| Very High (>1000 calls/min) | 1000m | 4000m | 1Gi | 2Gi | 5+ |

### Performance Notes

- **Policy engine overhead: ~0.15ms per call** (negligible)
- **Proxy stdio overhead: ~25ms per call** (Node.js child process latency)
- **SQLite write: batched at 1s intervals** (reduces I/O by 10x)
- **Token counting (tiktoken): ~1ms per 10KB of JSON**

### Horizontal Pod Autoscaling

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: mcp-guardian-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: mcp-guardian
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

---

## High Availability

### Multi-Replica Deployment

MCP Guardian supports running multiple replicas for HA. Each replica maintains its own SQLite database. For a shared audit trail, consider:

1. **Pod-level PVC** — Each pod gets its own database (default)
2. **Shared NFS/Ceph/CephFS volume** — All replicas share one database (set `ReadWriteMany` PVC)
3. **External database** — In future versions (roadmap: PostgreSQL support)

### Pod Disruption Budget

Ensures at least N replicas are running during voluntary disruptions:

```yaml
podDisruptionBudget:
  enabled: true
  minAvailable: 1    # At least 1 pod always available
```

### Anti-Affinity for Availability Zones

```yaml
affinity:
  podAntiAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      - labelSelector:
          matchLabels:
            app.kubernetes.io/name: mcp-guardian
        topologyKey: topology.kubernetes.io/zone
```

---

## Monitoring & Alerting

### Key Metrics to Monitor

| Metric | Source | Alert Threshold |
|--------|--------|----------------|
| Blocked tool calls rate | pino logs (`tool_blocked`) | >0 in 5min window (if unexpected) |
| Proxy latency p99 | Benchmark suite | >100ms |
| SQLite DB size | Pod filesystem | >80% of PVC |
| Pod restart count | Kubernetes metrics | >2 in 10min |

### Log Structure

All logs are structured JSON via pino:

```json
{
  "level": "warn",
  "time": "2026-05-09T06:27:38.386Z",
  "event": "tool_blocked",
  "requestId": "abc-123",
  "serverName": "filesystem",
  "toolName": "execute_command",
  "reason": "Tool 'execute_command' is explicitly denied",
  "rule": "deny-dangerous-tools"
}
```

### SIEM Integration

Pino logs can be streamed to:

- **Splunk** — Use Splunk Connect for Kubernetes or HTTP Event Collector (HEC)
- **Datadog** — Use Datadog Agent with `log_enabled: true`
- **Elasticsearch** — Filebeat → Logstash → Elasticsearch pipeline
- **Generic** — Pipe stdout to any syslog-compatible collector

### Prometheus Metrics (Future)

In v0.5+, MCP Guardian will expose Prometheus metrics at `/metrics`:
- `mcp_guardian_tools_calls_total{decision="pass|block|flag"}`
- `mcp_guardian_policy_evaluation_seconds`
- `mcp_guardian_db_size_bytes`
- `mcp_guardian_proxy_latency_seconds`

---

## Security Hardening

### Pod Security
```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  allowPrivilegeEscalation: false
  capabilities:
    drop: ["ALL"]
  readOnlyRootFilesystem: false  # SQLite needs write access to /data
```

### Network Policy

Restrict ingress to only the AI client namespace:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: mcp-guardian-netpol
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: mcp-guardian
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: ai-clients
      ports:
        - protocol: TCP
          port: 8080
```

### Secrets Management

Use Kubernetes Secrets for sensitive values:

```yaml
# Instead of:
# config.env.NVD_API_KEY: "hardcoded"

# Use:
apiVersion: v1
kind: Secret
metadata:
  name: mcp-guardian-secrets
data:
  NVD_API_KEY: <base64-encoded>
---
# Reference in values.yaml:
config:
  env:
    NVD_API_KEY: ""  # Set via secretRef in deployment template
```

### Regular Policy Review

Policies should be reviewed and updated:
1. **Weekly** — Review rate limiting thresholds
2. **Monthly** — Review tool allowlists/denylists
3. **Quarterly** — Full security audit of policy configuration

---

## Disaster Recovery

### Backup Strategy

The SQLite database (`~/.mcp-guardian/history.db`) contains:
- `security_scans` — historical CVE and security scan results
- `cost_records` — token usage and cost history
- `health_checks` — server health metrics
- `call_records` — every `tools/call` intercepted by the proxy

**Backup approach:**
1. Use PVC snapshots (cloud-native):
   ```bash
   # AWS EBS snapshot
   aws ec2 create-snapshot --volume-id <pvc-volume-id>
   
   # GCP PD snapshot
   gcloud compute snapshots create mcp-guardian-$(date +%Y%m%d) \
     --source-disk <disk-name>
   ```

2. Manual backup (portable):
   ```bash
   kubectl exec <pod-name> -- sqlite3 /data/mcp-guardian/history.db .dump > backup.sql
   ```

### Restoration

```bash
# Restore from backup
kubectl exec <pod-name> -- sqlite3 /data/mcp-guardian/history.db < backup.sql

# Or: PVC restore from snapshot
kubectl apply -f restore-pvc.yaml
```

### Graceful Shutdown

MCP Guardian handles SIGINT/SIGTERM gracefully:
1. Flushes all pending SQLite writes
2. Closes database connection
3. Exits with code 0

Kubernetes `terminationGracePeriodSeconds` should be at least **30s** to allow flush:

```yaml
spec:
  terminationGracePeriodSeconds: 30
```

---

## Troubleshooting

### Common Issues

| Symptom | Cause | Solution |
|---------|-------|----------|
| Proxy not starting | Missing config file | Verify ConfigMap mount |
| All calls blocked | `blocking-mode: block` with restrictive policy | Check `default-policy.yaml` and adjust allowlists |
| High latency | Resource limits too low | Increase `resources.limits.cpu` and `memory` |
| DB corruption | Pod killed during write | Enable PVC persistence, increase `terminationGracePeriodSeconds` |
| Policy not loaded | YAML syntax error | Run `mcp-guardian proxy --policy ./policy.yaml` locally to validate |

### Debugging

```bash
# Enable debug logging
helm upgrade mcp-guardian ./deploy/helm/mcp-guardian \
  --set config.env.LOG_LEVEL=debug

# View structured logs
kubectl logs -l app.kubernetes.io/name=mcp-guardian -f | jq .

# Check policy decisions
kubectl logs -l app.kubernetes.io/name=mcp-guardian | \
  jq 'select(.event == "policy_decision")'