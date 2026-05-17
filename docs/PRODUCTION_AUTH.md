# Production authentication — DPoP + mTLS

## DPoP (RFC 9449)

Sender-constrained OAuth tokens require a fresh DPoP proof JWT on each request. Guardian validates signature, `htm`/`htu`, `iat` freshness, `ath` (when a Bearer token is present), and **jti replay** (in-memory or Redis `SET NX`).

### Enable enforcement

```bash
export GUARDIAN_REQUIRE_DPOP=true
export REDIS_URL=redis://redis:6379   # required for multi-replica jti dedup
```

Clients must send:

- `Authorization: Bearer <access_token>` (when OAuth is enabled)
- `DPoP: <proof-jwt>` with `jwk` in the JWT protected header

For stdio MCP, pass proof via JSON-RPC meta:

```json
{
  "params": {
    "_meta": { "auth": { "Authorization": "Bearer …", "DPoP": "<proof-jwt>" } }
  }
}
```

### Helm values

```yaml
config:
  env:
    GUARDIAN_REQUIRE_DPOP: "true"
redis:
  enabled: true
```

With external Redis Sentinel, set `REDIS_SENTINELS` and `REDIS_SENTINEL_MASTER_NAME` instead of in-chart Redis (see [REDIS_HA.md](./REDIS_HA.md)).

## mTLS (proxy → upstream MCP)

Mutual TLS between Guardian and upstream HTTP/SSE MCP servers.

| Variable | Description |
|----------|-------------|
| `MCP_TLS_ENABLED` | `true` to enable client cert to upstream |
| `MCP_TLS_CA` | CA bundle to verify upstream |
| `MCP_TLS_CERT` | Proxy client certificate |
| `MCP_TLS_KEY` | Proxy client private key |
| `MCP_TLS_REJECT_UNAUTHORIZED` | `false` only in lab (default `true`) |

Helm mounts TLS material from a Secret at `/etc/mcp-guardian/tls/` (see `templates/mtls-secret.yaml`).

```yaml
mtls:
  enabled: true
  existingSecret: mcp-guardian-mtls
```

Certificate rotation requires a **pod restart** until hot-reload ships (`src/utils/mtls-watcher.ts` logs file changes).

## Checklist

1. OAuth issuer configured (`MCP_AUTH_*` / dashboard JWT).
2. `GUARDIAN_REQUIRE_DPOP=true` for sender-constrained tokens in production.
3. `REDIS_URL` or Sentinel/Cluster for DPoP jti + rate limits across replicas.
4. `MCP_TLS_*` + Helm `mtls.existingSecret` for zero-trust upstream links.
5. `DASHBOARD_AUTH_DISABLED=false` on any exposed dashboard.
