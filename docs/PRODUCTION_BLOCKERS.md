# Production blockers — MCP Guardian v2.8.0

Status as of **2.8.0** (production hardening bundle). Each item was verified with automated tests and Helm defaults.

**2.8.4+ enterprise fixes:** SSE `evaluateAsync`, shared attack-learning PG (`GUARDIAN_AUDIT_SYNC_ENABLED` + `DATABASE_URL`), `GUARDIAN_SEMANTIC_STRICT`, migration runner (`schema_migrations`), `GUARDIAN_TENANT_ID` for multi-tenant isolation.

| # | Blocker | Priority | Was | Now | Evidence |
|---|---------|----------|-----|-----|----------|
| 1 | PgBouncer pool exhaustion | P0 | Direct `:5432` could exhaust Postgres under HA | Fail-fast + Helm enforcement | `src/utils/pgbouncer-check.ts` (`checkPgBouncerAtStartup` in `src/container.ts`); `GUARDIAN_REQUIRE_PGBOUNCER`; Helm `pgbouncer.requireGuardianEnforcement: true` → `deploy/helm/mcp-guardian/values.yaml`, `templates/deployment.yaml`; `tests/utils/pgbouncer-check.test.ts` |
| 2 | Memory leak (8h+ sessions) | P0 | Hot LRU keys could extend TTL indefinitely | All LRU caches use `updateAgeOnGet: false` + max entries; periodic session sweep; heap monitor on proxy start | `policy-engine.ts`, `proxy-server.ts`, `llm-cache.ts`, `session-cache.ts`, `cve-checker.ts`; `startMemoryMonitor` in `proxy-server.ts` (`GUARDIAN_MEMORY_MONITOR=false` to disable); `tests/policy/policy-engine-memory.test.ts`, `tests/utils/memory-monitor.test.ts` |
| 3 | DPoP multi-replica race | P1 | In-memory jti store per pod | Redis `SET NX` + short distributed lock | `src/auth/dpop-nonce-store.ts` (`claimDpopJtiOnRedis`); `GUARDIAN_REQUIRE_DPOP` + `REDIS_URL` — [PRODUCTION_AUTH.md](./PRODUCTION_AUTH.md); `tests/auth/dpop-redis-lock.test.ts` |
| 4 | Cost auditor audit mode | P1 | Audit simulated token volumes without proxy traffic | Default **model-only** ($0 measured); `actual` from `call_records`; estimates opt-in | `src/utils/cost-estimate.ts` (`allowsCostEstimates`); `tests/services/cost-auditor-audit-mode.test.ts`, `tests/integration/full-pipeline.test.ts` |
| 5 | Plugin SDK npm publish | P2 | Monorepo-only path | `@mcp-guardian/plugin-sdk` package with `exports`, `prepublishOnly` build; workspace import documented | `packages/plugin-sdk/package.json`, [PLUGIN_SDK.md](./PLUGIN_SDK.md) |

## Quick verification

```bash
pnpm test
pnpm --filter @mcp-guardian/plugin-sdk run build
```

### PgBouncer (blocker #1)

```bash
export DB_TYPE=postgres
export DATABASE_URL=postgresql://u:p@postgres:5432/guardian
export GUARDIAN_REQUIRE_PGBOUNCER=true
node -e "import('./dist/container.js').then(()=>{})"  # exits 1 after build
```

### DPoP + Redis (blocker #3)

```bash
export GUARDIAN_REQUIRE_DPOP=true
export REDIS_URL=redis://localhost:6379
```

### Cost audit without estimates (blocker #4)

```bash
# Default: model-only, no fabricated usage
mcp-guardian audit --server my-server
# Opt-in legacy simulation:
GUARDIAN_COST_ALLOW_ESTIMATES=true mcp-guardian audit --server my-server
```

## Helm production defaults

- `pgbouncer.requireGuardianEnforcement: true` when using Postgres
- `config.env.GUARDIAN_STRICT_MODE: "true"`
- `redis.enabled: true` (or external Sentinel URL)
- `dpop.require: true` for sender-constrained OAuth (optional values key)

See [SCALE_AND_RESILIENCE.md](./SCALE_AND_RESILIENCE.md) and [deploy/PRODUCTION.md](../deploy/PRODUCTION.md).
