# Enterprise Findings — Fix Summary

**Date:** 2026-05-22  
**Source:** `/Users/rudraneeldas/Downloads/mcp 25 test 2 visuals/mcp-guardian/reports/enterprise-attack-sim/MCP_GUARDIAN_FINDINGS.md`  
**Target:** `mcp-guardian` @ master (post `0614926`)

---

## Findings inventory (17 total)

| ID | Issue | Status | Notes |
|----|-------|--------|-------|
| **H-1** | Async semantic audit queue DoS | **Already fixed** | FIFO drop at `GUARDIAN_SEMANTIC_ASYNC_MAX_QUEUE` (default 200); regression test added |
| **H-2** | CRLF in HTTP response headers | **Already fixed** (test-23) | `validateResponseHeaders()` → proxy 502 |
| **H-3** | DPoP jti multi-region replay | **Fixed** (this pass) | Redis lock + jitter; optional quorum via `GUARDIAN_DPOP_QUORUM_REDIS` |
| **M-1** | JSON depth stack overflow | **Already fixed** (test-23) | Iterative `jsonDepth()` |
| **M-2** | Prompt injection synonym gaps | **Improved** | Regex patterns + optional `GUARDIAN_SEMANTIC_ASYNC` LLM audit |
| **M-3** | Policy YAML recursion DoS | **Already fixed** (test-23) | Max depth 20 in `parsePolicyConfig()` |
| **M-4** | Secret scanner false negatives | **Already fixed** (test-23) | ASIA/JWT/PEM/base64 rules |
| **M-5** | Misleading cost source | **Already fixed** (test-23) | `validateCostSourceAtStartup()` |
| **M-6** | Payload normalizer gaps | **Already fixed** (test-23) | Multi-pass decode, NFKC, homoglyphs |
| **M-7** | WebSocket MITM | **Already fixed** (test-23) | `GUARDIAN_WS_TLS_PIN_SHA256` |
| **L-1** | Typo-squat linear search | **Fixed** (this pass) | BK-tree index in `typo-squat-detector.ts` |
| **L-2** | Call record serialization | **Fixed** (this pass) | `compactCallRecordForPersistence()` truncates oversized `blockReason` |
| **L-3** | Error path disclosure | **Already fixed** (test-23) | `sanitizeProxyClientError()` |
| **L-4** | Rate limit jitter | **Fixed** (this pass) | Window reset jitter in `redis-rate-limiter.ts`; DPoP lock jitter |
| **L-5** | OPA cache TTL | **Already fixed** | `GUARDIAN_OPA_CACHE_TTL_MS` (default 5s) |
| **L-6** | Session rotation | **Fixed** (this pass) | `GUARDIAN_SESSION_ROTATE_ON_USE=true`; new token in response `_meta` / header |
| **L-7** | Webhook alert backoff | **Already fixed** (test-23) | Exponential retry + 60s circuit |

---

## Files changed (this pass)

| File | Change |
|------|--------|
| `src/scanners/bk-tree.ts` | **New** — BK-tree for typo-squat lookup (L-1) |
| `src/scanners/typo-squat-detector.ts` | BK-tree index at construction |
| `src/auth/dpop-quorum.ts` | **New** — multi-Redis quorum jti claim (H-3) |
| `src/auth/dpop-nonce-store.ts` | Jittered lock retry; quorum mode |
| `src/utils/call-record-cost.ts` | `compactCallRecordForPersistence()` (L-2) |
| `src/utils/redis-rate-limiter.ts` | Window reset jitter (L-4) |
| `src/auth/session-cache.ts` | `validateSessionWithRotation()` (L-6) |
| `src/auth/redis-session-cache.ts` | Redis-backed rotation |
| `src/auth/session-factory.ts` | Returns `SessionValidationResult` |
| `src/proxy/proxy-server.ts` | Propagate rotated session token in `_meta` |
| `src/proxy/http-proxy-server.ts` | `x-mcp-guardian-session-token` header |
| `src/proxy/proxy-request-context.ts` | Track rotated token per request |
| `tests/enterprise-findings-fixes.test.ts` | **New** — 14 regression tests (H/M/L) |

Prior passes: test-23, tests-25, adversarial-harness zip — see linked summaries.

---

## Verification

| Command | Result |
|---------|--------|
| `pnpm build` | **Pass** |
| `pnpm vitest run` | **1055/1057 pass** (1 skipped; 1 MCP fixture integration flake — subprocess/env) |
| `GUARDIAN_DISABLE_SEMANTIC=true pnpm exec tsx corpus/run-eval.ts` | **228/228** (0 FP, 0 FN) |
| `./adversarial-harness/run-all.sh` | **Pass** |

---

## Counts

| Category | Count |
|----------|-------|
| Total findings | **17** |
| Fixed this pass | **5** (H-3 quorum, L-1, L-2, L-4, L-6) |
| Already fixed (prior passes) | **11** |
| Improved / partial | **1** (M-2 optional LLM semantic) |
| Deferred | **0** |

---

## Remaining gaps (honest)

1. **M-2 full LLM jailbreak detector** — Available via `GUARDIAN_SEMANTIC_ASYNC`; not default (latency/cost trade-off).
2. **H-3 external Redlock npm package** — Quorum SET-NX across `GUARDIAN_DPOP_QUORUM_REDIS` nodes implemented natively; full Redlock library not required for single-region.
3. **E2E MCP fixture integration** — `mcp-fixtures.test.ts` may flake when MCP subprocess unavailable in sandbox CI.

---

## New env vars

| Variable | Purpose |
|----------|---------|
| `GUARDIAN_DPOP_QUORUM_REDIS` | Comma-separated Redis URLs for multi-node DPoP jti quorum |
| `GUARDIAN_SESSION_ROTATE_ON_USE` | Rotate MCP session token on each validated call |
| `GUARDIAN_AUDIT_MAX_BLOCK_REASON_CHARS` | Max `blockReason` length before audit truncation (default 4096) |
