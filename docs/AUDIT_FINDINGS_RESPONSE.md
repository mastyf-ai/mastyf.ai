# Audit Findings Response (16 items)

| # | Finding | Status | Evidence |
|---|---------|--------|----------|
| 1 | Certifications 500 without DATABASE_URL | **Fixed** | [`apps/cloud/lib/cloud-db-guard.ts`](../apps/cloud/lib/cloud-db-guard.ts), [`apps/cloud/app/api/v1/certifications/route.ts`](../apps/cloud/app/api/v1/certifications/route.ts) |
| 2 | Badge API slow / no rate limit | **Partially fixed** | Rate limit existed; added JSON cache headers + stale-while-revalidate in [`package-score-resolver.ts`](../apps/cloud/lib/package-score-resolver.ts) |
| 3 | ReadResource swallows DB errors | **Fixed** | [`src/index.ts`](../src/index.ts) |
| 4 | Policy regex ReDoS gaps | **Fixed** (threat-intel) | [`src/policy/threat-intel-guard.ts`](../src/policy/threat-intel-guard.ts) |
| 5 | proxy-server 50+ imports | **Partial** | CVE gate lazy-loaded in [`src/proxy/proxy-server.ts`](../src/proxy/proxy-server.ts) |
| 6 | Federated learning dead code | **Fixed** | Lazy init when `MASTYF_AI_FEDERATED_LEARNING=true`; [`docs/EXPERIMENTAL_FEATURES.md`](EXPERIMENTAL_FEATURES.md) |
| 7 | evasion-attacks.json 662KB | **Closed** | Harness-only; not loaded at proxy startup |
| 8 | `internal/proxy/director.go` ingress auth | **Remapped** | N/A — use TS proxy auth; experimental [`apps/proxy-core/`](../apps/proxy-core/) hardened |
| 9 | `internal/server/server.go` global rate limit | **Remapped fixed** | [`src/proxy/ingress-rate-limit.ts`](../src/proxy/ingress-rate-limit.ts) |
| 10 | `internal/server/server.go` body limit | **Remapped** | TS proxy has caps; Go data plane: `PROXY_CORE_MAX_BODY_BYTES` |
| 11 | Session ID regex log injection | **N/A** | No `validSessionID` regex in repo |
| 12 | `internal/pricing/loader.go` TTL | **Closed** | [`src/clients/pricing-client.ts`](../src/clients/pricing-client.ts) 1h cache |
| 13 | `internal/proxy/stream.go` SSE buffer | **Remapped fixed** | Capped accumulator in [`src/proxy/sse-proxy-server.ts`](../src/proxy/sse-proxy-server.ts) |
| 14 | `internal/keyring/hasher.go` | **Closed** | bcrypt in [`apps/cloud/lib/api-keys.ts`](../apps/cloud/lib/api-keys.ts) |
| 15 | `internal/budget/lease_worker.go` | **N/A** | Redis daily budget in [`src/services/tenant-budget.ts`](../src/services/tenant-budget.ts) |
| 16 | Deep-scan 501 on Vercel | **Fixed** | Async queue [`apps/cloud/lib/deep-scan-jobs.ts`](../apps/cloud/lib/deep-scan-jobs.ts) + worker [`apps/cloud/scripts/deep-scan-worker.mjs`](../apps/cloud/scripts/deep-scan-worker.mjs) |
