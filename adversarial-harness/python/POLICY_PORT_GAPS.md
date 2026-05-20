# Python Policy Engine — Intentional Gaps vs TypeScript

Faithful port of `PolicyEngine.evaluate()` **sync pipeline** (`SYNC_POLICY_STRATEGIES` order):

1. `requestPromptInjectionStrategy`
2. `semanticGuardsStrategy`
3. `yamlRulesStrategy`

## Not ported (offline harness)

| TS component | Notes |
|--------------|-------|
| `evaluateAsync` | OPA, Redis rate limit, idempotency, policy eval cache |
| `evaluateIdempotency` | Requires store / async |
| `evaluateRedisRateLimit` | Redis-backed |
| `opaStrategy` | `OPA_URL` remote eval |
| `runShadowPolicy` | Side-effect telemetry only |
| `isFpWhitelisted` | AI FP whitelist |
| `resolvePolicyPrecedence` | Only needed when OPA + local disagree |
| `evaluateResponse` | Response-body prompt injection + exfil patterns |
| LRU `callCounters` TTL | Python uses plain dict + 60s window (same semantics) |

## Semantic guards

Honors `GUARDIAN_DISABLE_SEMANTIC=true` for deterministic corpus parity with TS eval when semantic layer is disabled in Node.

## YAML rules

Ports: tool allow/deny, categories, argPatterns, patterns, maxTokens, RBAC, maxCallsPerMinute, mode resolution (`audit`/`warn`/`block`).
