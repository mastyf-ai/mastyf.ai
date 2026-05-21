# Adversarial Harness Analysis

## Corpus evaluation

- **Fixtures on disk:** 151 attacks + 55 benign (+ edge-cases in full corpus dir → 228 entries evaluated)
- **Recall:** 100.0% attack block rate
- **False positive rate:** 3 on benign fixtures

## Evasion suite (120 probes)

Crafted to stress encoding, unicode, zero-width, SSRF variants, shell obfuscation, SQL/Nosql, tool-chain, and indirect exfil paths. **Blocked:** 120, **Bypassed:** 0.

## Python vs TypeScript parity

Agreement 435/437 (99.5%). Corpus mismatches: 1. Delta: 2 fixtures.

### Intentional Python port gaps (documented)

- OPA async strategy, Redis rate limit, idempotency store — not ported (offline eval uses sync pipeline only)
- `evaluateAsync` / policy eval cache — Python uses sync `evaluate()` only
- FP whitelist (`isFpWhitelisted`) — not ported
- Shadow policy side effects — skipped
- Response `evaluateResponse` / base64 exfil in responses — separate from tool-call eval

## Node integration findings

### AsyncSerialQueue vs RequestIdLock

- **CLI stdin** uses global `AsyncSerialQueue` (serializes all lines).
- **McpProxyServer** uses `RequestIdLock`: same MCP `id` serializes; distinct ids may overlap (by design).

### Streaming race tests

Chunk-boundary injection, concurrent chunk writers, and full-response jailbreak inspection exercised against live `streaming-inspector`.

### Secret scanner

14 rule samples (AWS, GitHub, Slack, Stripe, OpenAI, JWT, npm, generic API keys) run through live `scanForSecrets`.

## Blockers / partial completion

- None — full harness green

