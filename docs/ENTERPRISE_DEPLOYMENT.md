# Enterprise deployment checklist

Use this guide for production and multi-replica MCP Guardian deployments.

## Required for multi-replica (`GUARDIAN_ENTERPRISE_MODE=true`)

| Capability | Requires Redis |
|------------|----------------|
| Session flow / cross-call exfil detection | Yes |
| Distributed rate limiting | Yes |
| Shared policy eval cache | Recommended |

Set `REDIS_URL` (see [REDIS_HA.md](./REDIS_HA.md)). With `GUARDIAN_STRICT_MODE=true` or `GUARDIAN_REPLICA_COUNT>1`, startup fails if Redis is missing in enterprise mode.

## Semantic layers (honest tiering)

| Layer | Community | Enterprise |
|-------|-----------|------------|
| Regex + schema (request) | Yes | Yes |
| Sync semantic **request** gate | Opt-in (`GUARDIAN_SEMANTIC_SYNC_REQUEST=true`) | **Default ON** when LLM configured |
| Sync semantic **response** gate | Opt-in | Default ON in production |
| Async semantic audit / tribunal | Opt-in | Opt-in |

Env vars:

- `GUARDIAN_SEMANTIC_SYNC_REQUEST` — override enterprise default for request gate
- `GUARDIAN_SEMANTIC_SYNC_REQUEST_TIMEOUT_MS` — default 2500
- `GUARDIAN_SEMANTIC_SYNC_RESPONSE` — response gate

## License posture

When `GUARDIAN_ENTERPRISE_MODE=true`:

- `GUARDIAN_CI_BYPASS_LICENSE` and `GUARDIAN_DEV_UNLOCK_ALL` **must not** be set (startup error).
- Use a valid `GUARDIAN_LICENSE_KEY` from Pro setup ([PRO_SETUP.md](./PRO_SETUP.md)).

## Policy eval cache

Enterprise uses **opt-in** caching: only rules with `cacheable: true` in YAML (or allowlisted static rules) cache `pass` decisions.

Legacy broad caching: `GUARDIAN_POLICY_EVAL_CACHE_LEGACY_HEURISTIC=true` (not recommended).

## Rug-pull (OWASP MCP03)

- Fingerprints all `tools/list` responses (JSON-RPC with `id` or notifications).
- Cluster alerts use shared Redis; local flags expire after `GUARDIAN_RUGPULL_LOCAL_TTL_SEC` (default 3600).
- Clear stale local flags on restart: `GUARDIAN_RUGPULL_CLEAR_ON_START=true`.
- Ops API: `DELETE /api/internal/rug-pull` with body `{ "serverName": "...", "tenantId": "..." }` and header `X-Guardian-Internal-Token` matching `GUARDIAN_INTERNAL_ADMIN_TOKEN`.

## Proxy overload protection

`GUARDIAN_PROXY_MAX_INFLIGHT` (default 50) is enforced **before** policy/LLM work on `tools/call`.

## Validation matrix

1. Single node + enterprise + Redis — full session flow and rate limits.
2. Two replicas without Redis — strict enterprise startup should fail.
3. Rug-pull simulation — change tool description mid-session → block.
4. Inflight flood — 51 concurrent calls → early reject without policy eval spike.
