> **Synthetic simulation — not live adversary traffic against production.** Metrics in this folder come from `enterprise-attack-simulator.ts` (lab harness, ~3.4s wall clock). For CI-aligned instant-vs-batch learning numbers, use [../attack-learning-eval/](../attack-learning-eval/). For the 180-minute live-proxy escalation sim and PNG charts, see [../../sca/](../../sca/). **Do not use ROI or dollar-value claims** in these deliverables for procurement — they are illustrative only.

# Enterprise attack simulation & security assessment (May 2026)

Deliverables from the **11-test enterprise package** (v2.8.4–v2.8.6 scope): five-scenario attack sim, interactive dashboard, and static security review reports.

## Quick start

| Step | File |
|------|------|
| 1 | Open [attack-simulation-dashboard.html](attack-simulation-dashboard.html) in a browser (inline SVG charts, no server) |
| 2 | Read aggregate numbers in [attack-simulation-metrics.json](attack-simulation-metrics.json) → `aggregate` |
| 3 | Executive read: [MCP_GUARDIAN_EXECUTIVE_SUMMARY.md](MCP_GUARDIAN_EXECUTIVE_SUMMARY.md) |
| 4 | Scenario detail: [ATTACK_SIMULATION_COMPLETE.md](ATTACK_SIMULATION_COMPLETE.md) · [ATTACK_SIMULATION_ANALYSIS.md](ATTACK_SIMULATION_ANALYSIS.md) |
| 5 | Findings & remediation: [MCP_GUARDIAN_FINDINGS.md](MCP_GUARDIAN_FINDINGS.md) |

## Aggregate metrics (source of truth)

From `attack-simulation-metrics.json` (`aggregate`, generated 2026-05-20):

| Metric | Value |
|--------|-------|
| Total requests | 330 |
| Blocked | 308 |
| Block rate | **93.33%** |
| False positives | **0** (0.000% FP rate) |
| Avg detection latency | **38.81 ms** |
| P50 / P99 latency | 10 ms / 10 ms (simulator fast-path; not proxy SLO) |
| Avg confidence score | 0.67 (simulated learning curve) |
| Peak memory | 8.9 MB |
| Throughput | 95.82 req/s (sim rate) |

### Per-scenario (same JSON, `scenarios`)

| ID | Scenario | Attacks | Block rate | Avg detection latency |
|----|----------|---------|------------|------------------------|
| A | Credential exfiltration (finance) | 80 | 95.0% | 36.2 ms |
| B | Prompt injection (SaaS) | 100 | 94.0% | 41.2 ms |
| C | Token amplification (cost) | 50 | 88.0% | 35.2 ms |
| D | DPoP replay (multi-region) | 25 | 88.0% | 38.9 ms |
| E | SQL injection (healthcare) | 75 | 96.0% | 39.5 ms |

## Reproduce

```bash
npx tsx reports/enterprise-attack-sim/enterprise-attack-simulator.ts
npx tsx reports/enterprise-attack-sim/generate-dashboard.ts
```

## Report index

| Document | Audience |
|----------|----------|
| [START_HERE.md](START_HERE.md) | Orientation |
| [README_ANALYSIS_INDEX.md](README_ANALYSIS_INDEX.md) | Security assessment index |
| [ANALYSIS_COMPLETE.md](ANALYSIS_COMPLETE.md) | Assessment completion summary |
| [MCP_GUARDIAN_ANALYSIS.md](MCP_GUARDIAN_ANALYSIS.md) | Full-stack review (~8.6/10) |
| [MCP_GUARDIAN_FINDINGS.md](MCP_GUARDIAN_FINDINGS.md) | H/M/L findings with fix guidance |
| [ENTERPRISE_DEPLOYMENT_RESULTS.md](ENTERPRISE_DEPLOYMENT_RESULTS.md) | Deployment checklist (synthetic metrics) |
| [README_ATTACK_SIMULATION.md](README_ATTACK_SIMULATION.md) | Attack sim quick reference |

**Note:** Some narrative docs round block rates (e.g. “98%” for scenario B). Prefer **`attack-simulation-metrics.json`** when numbers must be exact.
