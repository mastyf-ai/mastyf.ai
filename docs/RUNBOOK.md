# MCP Guardian — Operational Runbooks

## Table of Contents

- [Circuit Breaker Tripped](#circuit-breaker-tripped)
- [Redis Connection Lost](#redis-connection-lost)
- [Policy File Corruption](#policy-file-corruption)
- [Dashboard Authentication Failure](#dashboard-authentication-failure)
- [High Token Usage Spike](#high-token-usage-spike)
- [Proxy Latency Degradation](#proxy-latency-degradation)
- [Database Corruption](#database-corruption)
- [Service Level Objectives](#service-level-objectives)

---

## Circuit Breaker Tripped

**Symptoms:**
- Log entries: `"event":"circuit_open"` at INFO level
- Dashboard shows `CIRCUIT OPEN` in per-server status table
- Prometheus metric `mcp_guardian_circuit_breaker_state{server_name="..."} = 1`
- AI client receives JSON-RPC error code `-32005`: *"Upstream MCP server unavailable — circuit breaker open"*

**Impact:**
- All traffic to the affected MCP server is blocked at the proxy
- No requests reach the upstream server until the circuit breaker resets
- Other MCP servers (unaffected by this breaker) continue normal operation

**Diagnosis:**
```bash
# Check recent circuit breaker events
grep -E '"circuit_open|circuit_half_open|circuit_closed"' policy-audit.jsonl | tail -20

# Check upstream health from the proxy pod
kubectl exec -it <guardian-pod> -- curl -v http://<mcp-server>:<port>/health
```

**Recovery:**
1. Verify upstream MCP server health — restart if necessary
2. Circuit breaker auto-transitions to `HALF_OPEN` after 15 seconds
3. First successful request in HALF_OPEN closes the circuit
4. If upstream is unreachable, manually restart the proxy to reset all breakers:
   ```bash
   kubectl rollout restart deployment mcp-guardian
   ```
5. If breakers trip repeatedly, increase `failureThreshold` in `CircuitBreaker` constructor (default: 5 failures in 60s)

**Prevention:**
- Monitor upstream server health with liveness probes
- Set appropriate resource limits (see `deploy/PRODUCTION.md` scaling table)
- Use multiple upstream replicas behind a load balancer

---

## Redis Connection Lost

**Symptoms:**
- Log entries: `[redis-session-cache]` errors, `ECONNREFUSED`, `ETIMEDOUT`
- WARN: `[redis-rate-limiter] Redis unavailable — falling back to in-memory rate limiter`

**Impact:**
- **Session cache**: JWT-bound sessions fail-open — each call re-validates the JWT (higher OIDC provider load)
- **Rate limiting**: Falls back to in-memory counters — no cross-replica coordination, but no blocking occurs
- **Policy engine**: Unaffected (runs entirely in-memory)
- **Circuit breaker**: Unaffected (in-memory)

**Diagnosis:**
```bash
# Check Redis connectivity from the proxy pod
kubectl exec -it <guardian-pod> -- redis-cli -h <redis-host> ping

# Verify env var
kubectl exec -it <guardian-pod> -- env | grep REDIS_URL
```

**Recovery:**
1. Verify `REDIS_URL` environment variable is correct
2. Restart Redis if down:
   ```bash
   kubectl rollout restart statefulset redis
   ```
3. Proxy automatically reconnects on next Redis operation (ioredis handles reconnection)
4. No proxy restart required — recovery is transparent

**Prevention:**
- Run Redis with `sentinel` for automatic failover
- Set `REDIS_URL` to a sentinel-aware connection string
- Monitor Redis memory usage and eviction policy

---

## Policy File Corruption

**Symptoms:**
- Log entry: `Failed to load policy: <error message>` (red in stderr)
- CLI output: `No policy file specified — running in audit-only mode`
- Dashboard shows `Policy Mode: NONE`
- All tool calls pass (no blocking) — potential security regression

**Impact:**
- **Fail-secure**: Proxy runs in `audit` mode — logs but does not block
- Previously blocked payloads now reach upstream MCP servers
- Policy hot-reload (`chokidar`) stops monitoring the corrupted file

**Diagnosis:**
```bash
# Validate YAML syntax
yamllint default-policy.yaml

# Check with js-yaml
node -e "require('js-yaml').load(require('fs').readFileSync('default-policy.yaml','utf-8'))"

# Check policy audit trail
cat policy-audit.jsonl | jq 'select(.change | contains("policy"))'
```

**Recovery:**
1. Fix YAML syntax in the policy file
2. PolicyWatcher auto-detects file changes and reloads (within 300ms)
3. Verify via dashboard: Policy Mode should show `BLOCK` or `WARN`
4. If auto-reload fails, restart proxy:
   ```bash
   kubectl rollout restart deployment mcp-guardian
   ```

**Prevention:**
- Store policy files in a ConfigMap (immutable on apply)
- Use policy file hash verification before deployment
- Configure `POLICY_AUDIT_ENABLED=true` to track every change

---

## Dashboard Authentication Failure

**Symptoms:**
- HTTP 401 responses from dashboard endpoints
- Log entry: `"event":"dashboard_login_failed"`
- Unable to access `/api/policy`, `/metrics`, or `/` without valid credentials

**Impact:**
- Dashboard inaccessible without authentication
- Policy monitoring and metrics may be unavailable
- Proxy continues processing traffic normally

**Diagnosis:**
```bash
# Check auth configuration
kubectl exec -it <guardian-pod> -- env | grep DASHBOARD_

# Check login attempts
grep 'dashboard_login' policy-audit.jsonl | tail -10
```

**Recovery:**
**API Key mode:**
1. Verify `DASHBOARD_API_KEY` is set and matches
2. Pass as `?api_key=<key>` or `Authorization: Bearer <key>` header

**JWT Session mode:**
1. Verify `DASHBOARD_JWT_SECRET`, `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD` are set
2. Navigate to `/login`, sign in with username/password
3. If rate-limited (5 attempts/min), wait 60 seconds or restart dashboard server

**Disable auth temporarily (not recommended for production):**
```bash
kubectl set env deployment/mcp-guardian DASHBOARD_AUTH_ENABLED=false
kubectl rollout restart deployment/mcp-guardian
```

---

## High Token Usage Spike

**Symptoms:**
- Token budget rule (`maxTokens: 50000`) triggers frequent blocks/flags
- `cost_records` table shows unusual per-call token counts
- Dashboard shows sudden increase in blocked requests

**Impact:**
- Legitimate long-context requests may be blocked
- Abnormal token usage may indicate prompt injection or model abuse

**Diagnosis:**
```bash
# Check recent blocked calls
grep '"tool_blocked"' policy-audit.jsonl | jq '{tool: .toolName, tokens: .requestTokens}' | tail -20

# Query cost records (SQLite)
sqlite3 ~/.mcp-guardian/history.db "SELECT server_name, tokens_used, estimated_cost_usd, created_at FROM cost_records ORDER BY created_at DESC LIMIT 20;"
```

**Recovery:**
1. If legitimate: increase `maxTokens` in policy YAML
2. If malicious: investigate the agent/tool generating high tokens
3. Add per-client rate limiting RBAC scopes for suspected agents
4. Review audit logs for prompt injection patterns

---

## Proxy Latency Degradation

**Symptoms:**
- `proxy_latency_ms` Prometheus metric p99 exceeds 100ms
- AI client experiences slow tool call responses
- Dashboard shows slow responses in per-server table

**Diagnosis:**
```bash
# Check latency by server
grep 'request_forwarded' policy-audit.jsonl | jq '{server: .serverName, latency: .proxyLatencyMs}' | sort

# Check circuit breaker state (frequent open/close degrades latency)
grep 'circuit_' policy-audit.jsonl | jq '{event: .event, time: .time}' | tail -20
```

**Recovery:**
1. Check upstream MCP server for performance issues
2. Increase proxy replicas to handle load:
   ```bash
   kubectl scale deployment mcp-guardian --replicas=3
   ```
3. Increase resource limits if approaching CPU/memory caps
4. Consider bypassing token counting for very large payloads (set `maxTokens` policy rule)

---

## Database Corruption

**Symptoms:**
- Log entry: `SQLITE_CORRUPT` or `database disk image is malformed`
- Proxy fails to start or crashes on DB operations
- Audit trail (call records, security scans) unreadable

**Diagnosis:**
```bash
# Check DB integrity
sqlite3 /data/mcp-guardian/history.db "PRAGMA integrity_check;"

# Check DB file size (growing unexpectedly?)
ls -lh /data/mcp-guardian/history.db
```

**Recovery:**
1. Restore from PVC snapshot (see `docs/DISASTER_RECOVERY.md`)
2. If no backup exists, delete corrupted DB and restart proxy (audit data lost, proxy operational):
   ```bash
   kubectl exec -it <guardian-pod> -- rm /data/mcp-guardian/history.db
   kubectl rollout restart deployment mcp-guardian
   ```

**Prevention:**
- Enable PVC persistence with daily snapshots
- Set `terminationGracePeriodSeconds: 30` for graceful DB flush
- Use PostgreSQL backend for production (see `src/database/postgres-db.ts`)

---

## Service Level Objectives

| SLO | Target | Measurement |
|-----|--------|-------------|
| **Uptime** | 99.9% monthly | `mcp_guardian_uptime_seconds` (Prometheus) |
| **Policy evaluation latency** | p99 < 5ms | `mcp_guardian_proxy_latency_ms` (Prometheus) |
| **Block accuracy** | 100% (no false negatives) | `tool_blocked` events vs known-bad payloads |
| **False positive rate** | < 0.1% | Flagged-then-passed ratio per server |
| **Auth availability** | 99.95% | OIDC discovery success rate |
| **Dashboard availability** | 99.9% | HTTP 200/401 rate (401 = auth system working, rejecting unauthenticated) |
| **Audit completeness** | 100% | Every `tools/call` has a corresponding `policy_decision` event |