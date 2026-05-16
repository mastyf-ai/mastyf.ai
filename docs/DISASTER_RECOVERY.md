# MCP Guardian — Disaster Recovery

## State Inventory

| State Type | Storage | RPO | RTO | Acceptable Loss? |
|------------|---------|-----|-----|-----------------|
| Audit logs (call records, scans, costs) | SQLite / PostgreSQL | Durability: ≤1s; Backup RPO: 1h-24h | 10min | Minimize — compliance gap |
| Policy configuration | YAML (ConfigMap) | N/A (immutable at rest) | 0s (hot-reloaded) | No — security baseline |
| Redis sessions (OAuth cache) | Redis | 5min (TTL) | 30s | Yes — JWTs re-validated |
| Redis rate limit counters | Redis | 1min (window reset) | 60s | Yes — counters reset each window |
| In-memory rate limit counters | Process heap | 0 (lost on restart) | 0s | Yes — local counters acceptable |
| Circuit breaker state | Process heap | 0 | 0s (resets to CLOSED) | Yes — resets on restart |

## RTO by Tier

| Tier | Component | RTO | Recovery Action |
|------|-----------|-----|----------------|
| Tier 1 | Policy evaluation (in-memory) | 0s | Always available while proxy runs |
| Tier 1 | Proxy forwarding (stdio/HTTP) | 0s | Proxy is the process itself |
| Tier 2 | Audit logging | 10min | PVC snapshot restore or PostgreSQL replica |
| Tier 2 | Prometheus metrics | 5min | Scrape restarts — counters reset |
| Tier 3 | Distributed rate limiting (Redis) | 30min | Redis reconnect + counter warm-up |
| Tier 3 | Session cache (Redis) | 5min | TTL expiry; JWTs re-validated |

## Redis Failure Modes

**Node unreachable**: Session cache falls back to in-memory. Rate limiter falls back to local counters. Policy engine and circuit breaker unaffected.

**Data corruption**: Rate limit counters inaccurate for one window (1min), then reset. `FLUSHDB` + proxy restart recovers.

## SQLite Failure Modes

**Corruption**: Stop proxy → restore from PVC snapshot → restart. RPO: daily (snapshot) or hourly (cron dump). RTO: 10min.

**Disk full**: `kubectl patch pvc` to resize, or archive old records with `DELETE ... WHERE created_at < date('now','-90 days')`.

## Backup Strategy

### SQLite
- **Automated**: Daily PVC snapshots via CSI snapshotter, 30-day retention
- **Manual**: Hourly `sqlite3 .dump` to backup directory via cron
- **Verification**: Weekly restore test to staging

### Redis
- Not critical — ephemeral by design. If needed, Redis Sentinel with AOF persistence.
- Manual: `redis-cli BGSAVE` → copy RDB file

### Policy
- ConfigMap (Kubernetes etcd snapshots) + git repository
- Hash verified by PolicyAuditor on every change

## Recovery Drills

**Redis outage**: `kubectl delete pod redis-0` → verify proxy continues with in-memory fallback → Redis auto-restarts via StatefulSet

**Database loss**: Take backup → delete PVC → restore from snapshot → restart proxy → verify audit records intact

**Full restart**: `kubectl rollout restart deployment mcp-guardian` → verify all pods healthy → test tools/call → check policy_decision events

## Rollback

**Version**: `helm rollback mcp-guardian <revision>`

**Policy**: `git checkout <previous-commit> -- default-policy.yaml` → update ConfigMap → PolicyWatcher auto-reloads within 300ms