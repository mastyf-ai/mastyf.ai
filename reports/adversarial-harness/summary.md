# Adversarial Harness Summary

Generated: 2026-05-21T15:07:33.789Z

## Key metrics

| Metric | Value |
|--------|-------|
| Corpus attacks blocked | 154/154 |
| Corpus benign pass | 71/74 |
| Corpus false positives | 3 |
| Evasion blocked / total | 120/120 |
| Evasion bypassed | 0 |
| Node/Python parity | 435/437 (99.5%) |
| Corpus parity mismatches | 1 |
| Node integration tests | 26/26 |
| Overall harness | PASS |

## Proxy concurrency (ms)

- AsyncSerialQueue p50: 2.34 p95: 3.01
- Proxy handleClientInput p50: 60.55 p95: 88.84

## Test layers

| Layer | Real integration? |
|-------|-------------------|
| Python policy engine | Offline mirror of TS sync pipeline |
| Node corpus eval | Live PolicyEngine (TS) |
| Node proxy tests | Real subprocess MCP + McpProxyServer |
| Secret scanner | Live scanner module |
| Streaming race | Live streaming-inspector |

## Paths

- Harness: `adversarial-harness/`
- Evasion bundle: `adversarial-harness/evasion-attacks.json`
- Reports: `reports/adversarial-harness/`
