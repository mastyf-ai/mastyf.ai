# Proxy SLO by concurrency (tiered deployment gates)

**Run:** 2026-05-18T19:41:38.994Z  
**Command:** `pnpm benchmark:proxy-tiers`

## Tiered SLO table (proxy path)

| Concurrency (in-flight) | p95 gate (ms) | p50 | p95 | p99 | Correctness | Overall |
|-------------------------|---------------|-----|-----|-----|-------------|---------|
| 1 | 150 | ~155.5 | ~155.5 | ~155.5 | 100% | **FAIL** |
| 10 | 500 | ~368.1 | ~420.3 | ~420.3 | 100% | **PASS** |
| 25 | 1500 | ~1418.2 | ~1953.3 | ~1982.5 | 100% | **FAIL** |
| 50 | 3000 | ~2336.1 | ~2906.0 | ~2948.1 | 100% | **PASS** |

Tiers env: `BENCH_PROXY_CONCURRENCY_TIERS` (default `1,10,25,50`).

**Guidance:** Use **policy-only** (`pnpm benchmark:concurrent`, 1000-way) for rule-tuning latency (p95 &lt; 500 ms). Use **proxy tiers** above for deployment SLOs under realistic in-flight load. Use **proxy 1k burst** (`pnpm benchmark:concurrent-proxy`) for worst-case stdio contention.

## Configuration

| Setting | Value |
|---------|--------|
| Workload | In-process `McpProxyServer` → echo (`/Users/rudraneeldas/Desktop/mcp-guardian/benchmarks/fixtures/echo-server.cjs`) |
| Policy | Block `eval`; pass `search` |
| Traffic mix | `i % 10 === 0` → `eval` (block); else `search` |

## HTTP/SSE transport variant

| Status | Notes |
|--------|--------|
| **BLOCKED** | No local HTTP MCP echo fixture or session bootstrap in-repo; SseProxyServer/HttpProxyServer need live upstream + SSE handshake. Use stdio proxy tiers for deployment SLOs. |

## Machine

- darwin arm64, 10 CPUs, Node v23.11.0
- Host: Rudraneels-Mac-mini.local

## Artifacts

- JSON: `benchmarks/results/proxy-slo-by-concurrency-latest.json`
