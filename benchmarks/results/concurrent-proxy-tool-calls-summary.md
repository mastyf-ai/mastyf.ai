# Concurrent proxy tool calls benchmark

**Run:** 2026-05-18T19:17:23.396Z  
**Command:** `pnpm exec tsx benchmarks/concurrent-proxy-tool-calls.ts`

## Configuration

| Setting | Value |
|---------|--------|
| Concurrency | **1000** (achieved 1000 simultaneous `tools/call` via proxy) |
| Workload | In-process `McpProxyServer` → echo fixture (`/Users/rudraneeldas/Desktop/mcp-guardian/benchmarks/fixtures/echo-server.cjs`) |
| Policy | Block `eval`; pass `search` |
| Traffic mix | Indices `i % 10 === 0` → `eval` (expect block); else `search` (expect pass) |

## Correctness

| Metric | Result |
|--------|--------|
| Total calls | 1000 |
| Passed (expected outcome) | **1000** |
| Failed | **0** |
| Correctness | **100%** |
| Blocked (eval) | 100 / 100 expected |
| Allowed (search) | 900 / 900 expected |
| Timeouts | 0 |

## Latency (per tools/call RTT through proxy, ms)

| Percentile | ms |
|------------|-----|
| p50 | ~27006.1 |
| p95 | ~37025.2 |
| p99 | ~38110.2 |
| max | ~49374.9 |
| avg | ~26168.5 |

**Wall clock:** 54030 ms total (~19 calls/s for the burst).

## SLO pass/fail

| SLO | Target | Measured | Status |
|-----|--------|----------|--------|
| Correctness | 100% expected decisions | 100% | **PASS** |
| p95 latency | < 5000 ms | ~37025.2 ms | **FAIL** |
| p99 latency | < 10000 ms | ~38110.2 ms | **FAIL** |
| **Overall** | | | **FAIL** |

SLO env overrides: `CONCURRENT_PROXY_P95_SLO_MS` (default 5000), `CONCURRENT_PROXY_P99_SLO_MS` (default 10000).

Sequential proxy CI gate (`benchmarks/run.ts`): p95 **150 ms** — not applicable to this concurrent burst.

## Machine notes

- darwin arm64, 10 CPUs, Node v23.11.0
- Host: Rudraneels-Mac-mini.local

## Artifacts

- JSON: `benchmarks/results/concurrent-proxy-tool-calls-latest.json`
