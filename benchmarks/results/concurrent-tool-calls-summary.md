# Concurrent tool calls benchmark

**Run:** 2026-05-18T19:11:40.269Z  
**Command:** `pnpm exec tsx benchmarks/concurrent-tool-calls.ts`

## Configuration

| Setting | Value |
|---------|--------|
| Concurrency | **1000** (achieved 1000 simultaneous `evaluateAsync` calls) |
| Workload | In-process `PolicyEngine.evaluateAsync` — no live external MCP |
| Policy | Block `eval`; pass `read_file` |
| Traffic mix | Indices `i % 10 === 0` → `eval` (expect block); else `read_file` (expect pass) |

## Correctness

| Metric | Result |
|--------|--------|
| Total evaluations | 1000 |
| Passed (expected action) | **1000** |
| Failed | **0** |
| Correctness | **100%** |
| Blocked (eval) | 100 / 100 expected |
| Allowed (read_file) | 900 / 900 expected |
| Errors | None |

## Latency (per evaluation, ms)

| Percentile | ms |
|------------|-----|
| p50 | ~96.3 |
| p95 | ~100.3 |
| p99 | ~100.7 |
| max | ~101.0 |
| avg | ~96.1 |

**Wall clock:** 101 ms total (~9,901 eval/s for the burst).

## SLO pass/fail

| SLO | Target | Measured | Status |
|-----|--------|----------|--------|
| Correctness | 100% expected decisions | 100% | **PASS** |
| p95 latency | < 500 ms | ~100.3 ms | **PASS** |
| p99 latency | < 1000 ms | ~100.7 ms | **PASS** |
| **Overall** | | | **PASS** |

SLO env overrides: `CONCURRENT_P95_SLO_MS` (default 500), `CONCURRENT_P99_SLO_MS` (default 1000).

## Machine notes

- darwin arm64, 10 CPUs, Node v23.11.0
- Host: Rudraneels-Mac-mini.local
- Latencies reflect concurrent scheduling contention on a single shared `PolicyEngine` instance (all 1000 promises started together).

## Artifacts

- JSON: `benchmarks/results/concurrent-tool-calls-latest.json`

## Recommendations

- **Policy-only** (`pnpm benchmark:concurrent`): rule tuning and policy latency — not deployment proxy RTT.
- **Proxy tiers** (`pnpm benchmark:proxy-tiers`): deployment SLOs at realistic in-flight load (1–50 concurrent per instance).
- **Multi-replica** (`pnpm benchmark:multi-proxy`): horizontal scale vs single-proxy 1k burst.
- **Proxy 1k burst** (`pnpm benchmark:concurrent-proxy`): worst-case stdio contention on one proxy.
- **Pipelined CI gate** (`pnpm benchmark:proxy-slo`): sequential/pipelined RTT with p95 &lt; 150 ms.

### Tiered proxy SLO gates (deployment)

| In-flight per instance | p95 gate | Use case |
|------------------------|----------|----------|
| 1 | &lt; 150 ms | Match CI `benchmarks/run.ts` |
| 10 | &lt; 500 ms | Light queue |
| 25 | &lt; 1500 ms | Moderate queue |
| 50 | &lt; 3000 ms | Heavy queue |
| 1000 (policy-only) | p95 &lt; 500 ms, p99 &lt; 1000 ms | Rule tuning only |
| 1000 (proxy burst) | p95 &lt; 5000 ms, p99 &lt; 10000 ms | Worst-case single proxy |

Run tiers: `pnpm benchmark:proxy-tiers` → `benchmarks/results/proxy-slo-by-concurrency-summary.md`.

### Multi-replica vs single proxy

Run `pnpm benchmark:multi-proxy` (default K=10, 1000 total calls) after `pnpm benchmark:concurrent-proxy` for baseline comparison → `benchmarks/results/concurrent-multi-proxy-summary.md`.

## Three-way comparison (latest runs, 2026-05-18)

| Benchmark | Command | Concurrency | Correctness | p50 | p95 | p99 | Wall | SLO gate | SLO |
|-----------|---------|-------------|-------------|-----|-----|-----|------|----------|-----|
| Policy-only | `benchmark:concurrent` | 1000 parallel `evaluateAsync` | 100% | 96 ms | 100 ms | 101 ms | 101 ms | p95 &lt; 500 ms | **PASS** |
| Proxy tiers | `benchmark:proxy-tiers` | 1 / 10 / 25 / 50 in-flight | 100% each | 155 / 368 / 1418 / 2336 ms | 155 / 420 / 1953 / 2906 ms | — | — | tiered p95 gates | **1,25 FAIL; 10,50 PASS** |
| Multi-proxy | `benchmark:multi-proxy` | 10×100 (1000 total) | 100% | 10.0 s | 11.7 s | 13.8 s | 16.9 s | (vs 1k burst) | **~3× lower p95 than single** |
| Proxy 1k burst | `benchmark:concurrent-proxy` | 1000 parallel `tools/call` | 100% | 27.0 s | 37.0 s | 38.1 s | 54.0 s | p95 &lt; 5000 ms | **FAIL** (latency) |
| Proxy pipelined | `benchmark:proxy-slo` | 100 pipelined RTT (blocking policy) | — | 2.4 s | 3.6 s | 4.3 s | ~14 s | p95 &lt; 150 ms | **FAIL** |

Notes:

- **Policy-only** is ~370× faster p95 than **proxy 1k burst** (in-process policy vs stdio proxy + echo under contention).
- **`benchmarks/run.ts`** sends all measured requests without awaiting each response (pipelined), so p95 reflects queue depth as much as per-hop RTT; CI uses `BENCH_ITERATIONS=50` and `BENCH_STRICT=false` for artifact upload.
- Sequential CI gate (**150 ms** p95) applies to pipelined proxy scenarios, not the concurrent-proxy burst (defaults: 5000 ms / 10000 ms).

### Artifacts

| Benchmark | JSON |
|-----------|------|
| Policy-only | `benchmarks/results/concurrent-tool-calls-latest.json` |
| Proxy tiers | `benchmarks/results/proxy-slo-by-concurrency-latest.json` |
| Multi-proxy | `benchmarks/results/concurrent-multi-proxy-latest.json` |
| Proxy 1k burst | `benchmarks/results/concurrent-proxy-tool-calls-latest.json` |
| Proxy pipelined | `benchmark-report.json` (repo root) |
