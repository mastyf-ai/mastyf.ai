# Concurrent multi-proxy benchmark

**Run:** 2026-05-18T20:50:56.601Z  
**Command:** `pnpm benchmark:multi-proxy`

## Configuration

| Setting | Value |
|---------|--------|
| Replicas (K) | **10** |
| Total calls | **1000** |
| Calls per replica | **100** |
| Workload | K forked workers → each `McpProxyServer` + echo |

## Aggregate (global)

| Metric | Value |
|--------|--------|
| Correctness | **100%** |
| p50 | ~10000.9 ms |
| p95 | ~11735.9 ms |
| p99 | ~13788.3 ms |
| Wall | 16860 ms |

## Per-replica

| Replica | Calls | Correctness | p95 | Wall (ms) |
|---------|-------|-------------|-----|-----------|
| 0 | 100 | 100% | ~11766.3 | 15024 |
| 1 | 100 | 100% | ~11463.2 | 15111 |
| 2 | 100 | 100% | ~11492.6 | 15105 |
| 3 | 100 | 100% | ~13821.7 | 15119 |
| 4 | 100 | 100% | ~13748.8 | 14999 |
| 5 | 100 | 100% | ~11534.4 | 15142 |
| 6 | 100 | 100% | ~11552.3 | 15150 |
| 7 | 100 | 100% | ~11518.5 | 15091 |
| 8 | 100 | 100% | ~11368.8 | 15050 |
| 9 | 100 | 100% | ~13370.0 | 15098 |

## vs single-proxy 1k burst

| Metric | Single proxy (1k) | Multi-proxy (10×100) | Delta (multi − single) |
|--------|-------------------|--------------------------------------------------|-------------------------|
| p50 | ~27006.111874999995 ms | ~10000.9 ms | -17005.2 ms |
| p95 | ~37025.202792 ms | ~11735.9 ms | -25289.3 ms |
| p99 | ~38110.176 ms | ~13788.3 ms | -24321.9 ms |
| Wall | 54030 ms | 16860 ms | -37170 ms |

Multi-replica sharding reduced global p95 vs single-proxy 1k burst (stdio bottleneck).

## Guidance

- **Policy-only** (`benchmark:concurrent`): rule tuning, 1000-way in-process policy.
- **Proxy tiers** (`benchmark:proxy-tiers`): deployment SLOs at 1–50 in-flight.
- **Multi-replica**: stdio serialization bottleneck; lower tail latency when sharded across K processes.

## Machine

- darwin arm64, 10 CPUs, Node v23.11.0

## Artifacts

- JSON: `benchmarks/results/concurrent-multi-proxy-latest.json`
