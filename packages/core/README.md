# 🛡️ MCP MastyfAi

**Runtime security, cost governance, and health monitoring proxy for MCP infrastructure.**

[![npm version](https://img.shields.io/npm/v/@mastyf-ai/server)](https://www.npmjs.com/package/@mastyf-ai/server)
[![npm downloads](https://img.shields.io/npm/dm/@mastyf-ai/server)](https://www.npmjs.com/package/@mastyf-ai/server)
[![mastyf-ai MCP server](https://glama.ai/mcp/servers/mastyf-ai/mastyf-ai/badges/score.svg)](https://glama.ai/mcp/servers/mastyf-ai/mastyf-ai)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)](https://www.typescriptlang.org/)
[![MCP SDK](https://img.shields.io/badge/MCP_SDK-1.0-green)](https://github.com/modelcontextprotocol/typescript-sdk)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
[![CI](https://github.com/mastyf-ai/mastyf-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/mastyf-ai/mastyf-ai/actions/workflows/ci.yml)

MCP Mastyf AI sits between AI agents and MCP servers, enforcing **active security policies**, tracking **real token costs**, monitoring **server health**, and providing **enterprise observability** — all through a YAML-configurable engine with hot-reload.

It works as a **transparent proxy**, a **standalone CLI**, an **MCP server** (so agents can self-audit), and a **pnpm monorepo** — install only what you need.

### Detection tiers (honest)

| Path | Community | Enterprise (`MASTYF_AI_ENTERPRISE_MODE=true`) |
|------|-----------|-----------------------------------------------|
| Request (`tools/call`) | Regex + schema | + sync semantic gate (default when LLM configured) |
| Response | Optional sync gate | Sync response gate (production default) |
| Async audit / tribunal | Opt-in | Opt-in |

See [ENTERPRISE_DEPLOYMENT.md](../../docs/ENTERPRISE_DEPLOYMENT.md) for Redis, multi-replica, and license requirements.

**Semantic queue note:** `@mastyf-ai/core` semantic queue caps are **per Node.js process** (and per worker thread). Multi-replica proxy deployments should use proxy-level Redis caps or run semantic scans on the main thread.

---

## Quick Start

```bash
# Install globally
npm install -g @mastyf-ai/server

# Scan your MCP servers for CVEs, secrets, and injection attacks
mastyf-ai scan --all

# Proxy with active policy enforcement
mastyf-ai proxy --policy ./default-policy.yaml --blocking-mode block

# Generate a full security-cost-health report
mastyf-ai report --all --format markdown --output mastyf-ai-report.md

# Run as an MCP server (AI agents can self-audit)
mastyf-ai       # stdio transport, auto-starts MCP server
```

---

## Features

### Security
- **Three-layer detection engine** — Regex triage (TR39 confusables offline, `before…then` / `first…then` chaining) → Schema analysis (Ajv validation, recursive depth, `maxLength`) → LLM semantic verdict (Anthropic/OpenAI/Ollama) with **circuit breaker**, **per-tenant queue caps**, and **local heuristic fallback** when no API key or rate-limited (**v2.10.0**)
- **YAML policy engine** — Tool allowlists/denylists, regex patterns, rate limits, token budgets, RBAC, argument-level field patterns, destructive category detection, and **default-deny** (fail-closed) catch-all
- **Hot-reload policies** — File watcher atomically swaps policy engine on YAML changes — zero-downtime policy updates
- **50+ secret patterns** — OpenAI, Anthropic, GitHub, AWS, GCP, Azure, Stripe, Slack, Twilio, SendGrid, Datadog, CircleCI, Jenkins, Firebase, Cloudflare, HuggingFace, GitLab, NPM, Vercel, Heroku, database connection strings, RSA/PEM private keys, JWT secrets, and URI credentials
- **Shannon entropy analysis** — Detects base64/hex-encoded secrets that regex patterns miss, with configurable allowlist
- **AST command validation** — Shell-quote-based tokenizer with 33 dangerous commands, 6 structural operators, 5 suspicious path patterns, and Unicode homoglyph normalization (Cyrillic, fullwidth, zero-width attacks)
- **CVE scanning** — OSV.dev + NVD with transitive dependency tree scanning (200+ packages), direct/transitive triage, and LRU result caching
- **Response inspection** — Prompt injection and data exfiltration detection in tool responses
- **Hardcoded secret detection** — Scans adjacent `.env` files, `docker-compose.yml`, and environment variables
- **Typo-squatting detection** — Levenshtein distance analysis against known MCP server names
- **Auth weakness probing** — Missing authentication, unencrypted transport detection

### Authentication & Zero Trust
- **OAuth 2.1 / OIDC** — JWT validation with OIDC Discovery, **algorithm pinning** (RS256/384/512, ES256/384, PS256 — rejects `alg: none` confusion attacks), audience/issuer validation, agent identity extraction
- **DPoP** — RFC 9449 sender-constrained tokens for replay-proof authentication
- **RBAC** — Scope-based and client-ID-based access control in policy engine
- **mTLS** — Mutual TLS with client certificates for proxy ↔ upstream communication
- **Dashboard authentication** — JWT session tokens, API key auth, CSRF protection, rate-limited login

### Cost Governance
- **Real token counting** — Proxy intercepts `tools/call` traffic and counts tokens via `tiktoken` (o200k_base for OpenAI, char-ratio estimates for Anthropic/Google/DeepSeek/Meta/Mistral)
- **17 providers, 2,138 models** — Live pricing via litellm, with per-model cost comparison
- **Cost efficiency scoring** — Weighted 3-way composite score: security (40%), health (30%), cost efficiency (30%)
- **Per-tool breakdown** — Tokens, duration, and estimated cost for every intercepted call

### Health & Observability
- **Live JSON-RPC probes** — Latency, success rate, tool count, and context pressure
- **Circuit breaker** — 3-state pattern (CLOSED, OPEN, HALF_OPEN) protects upstream servers from cascading failures
- **Prometheus metrics** — Counters (requests, blocked, auth failures), gauges (circuit breaker state, active sessions), histograms (proxy latency, auth latency)
- **`/healthz` and `/readyz` endpoints** — Liveness and readiness probes for K8s deployment
- **WebSocket dashboard** — Real-time push broadcaster replacing 5s polling, with graceful fallback
- **OpenTelemetry** — Distributed tracing across proxy and MCP servers via OTLP
- **Structured logging** — pino with request-ID tracing, policy decision audit trails
- **Webhook alerting** — Slack and Discord webhook support for critical policy events with severity filtering

### Architecture
- **pnpm monorepo** — `packages/core` (detection engine), `packages/cli`, `packages/server` (MCP server), plus root `src/` (proxy, scanners, services, policy, auth)
- **better-sqlite3** — Native, WAL-mode, crash-safe database with **advisory file locking** (prevents multi-instance corruption), versioned migrations, automated purge, and prepared statements
- **Dependency injection interfaces** — `IHistoryDb`, `ISecurityScanner`, `ICostAuditor`, `IHealthMonitor`, `IPolicyEngine` for testability and swappable implementations
- **Secret provider interface** — Pluggable secret backends: EnvSecretProvider (default), HashiCorpVaultProvider, AwsSecretsManagerProvider
- **Redis cluster-state enforcement** — Warns on multi-replica/K8s without Redis; `MASTYF_AI_STRICT_MODE=true` refuses startup
- **Graceful shutdown** — Async hook system flushes DB, closes connections, and WAL-checkpoints before exit

### Deployment
- **Helm chart** — K8s Deployment with liveness/readiness probes, resource limits, security context (non-root, read-only filesystem, dropped capabilities), NetworkPolicy (ingress/egress rules, CIDR-based dashboard access), and ExternalSecrets support
- **Helm release workflow** — GitHub Actions auto-publishes chart to `gh-pages` on tagged releases
- **Docker** — Multi-stage build with production-ready image
- **Supply chain CI** — `npm audit`, CycloneDX SBOM generation, npm provenance attestation

### Testing & Quality
- **207 tests** across 19 test files (core, server, cli, integration, e2e, fuzz)
- **Code coverage** — 80% lines, 80% functions, 75% branches enforced in CI
- **E2E proxy tests** — Real proxy spawns with policy YAML, sends JSON-RPC, verifies block/pass decisions
- **Fuzz testing** — Payload normalizer and policy engine fuzzing
- **Red-team corpus** — Labeled poisoned/benign test cases with precision/recall measurement

### Cost Audit & Auto-Detection
- **CLI cost audit** — `mastyf-ai audit --all` queries proxy databases for real token counts and estimates costs per model
- **Auto-detection scripts** — `scripts/full-cost-report.cjs` reads Cline model config from `~/.cline/data/globalState.json`, auto-detects pricing, queries proxy DBs for precise MCP tool call costs, and computes LLM conversation cost estimates
- **Multi-proxy DB isolation** — `MASTYF_AI_DB_PATH` env var allows running multiple proxy instances (e.g., github + filesystem) with separate databases, preventing lock conflicts
- **Per-call breakdown** — Every `tools/call` through the proxy is logged with request/response tokens, duration, and estimated cost

### Recent Fixes (v2.3.24)
- **DB lock resolution** — `HistoryDatabase` constructor now checks `MASTYF_AI_DB_PATH` env var as fallback, enabling multiple concurrent proxy instances without lock conflicts
- **container.ts** — `createContainer()` respects `MASTYF_AI_DB_PATH` for all CLI commands (scan, audit, health, report, proxy)
- **index.ts** — MCP server startup sets a separate DB path to avoid conflicts with running proxy instances
- **macOS `/tmp` symlink** — Launch scripts use `/private/tmp` to avoid `proper-lockfile` stat errors on macOS

---

## Installation

```bash
# Global CLI
npm install -g @mastyf-ai/server

# As an MCP server (for AI assistant integration)
npx @mastyf-ai/server

# From source (monorepo)
git clone https://github.com/mastyf-ai/mastyf-ai.git
cd mastyf-ai
pnpm install
pnpm build
pnpm start
```

---

## CLI Reference

### `mastyf-ai scan`

```bash
mastyf-ai scan --all                          # Scan all discoverable MCP configs
mastyf-ai scan --config ./mcp.json             # Scan a specific config
mastyf-ai scan --fail-on-critical              # Exit 1 if any CRITICAL CVE found
mastyf-ai scan --fail-on-secrets               # Exit 1 if any hardcoded secret found
mastyf-ai scan --threshold-score 60            # Exit 2 if any server scores below 60
```

Outputs per-server CVE list, auth status, typo-squat risk, secrets found, and composite security score (0–100).

### `mastyf-ai audit`

```bash
mastyf-ai audit --all                          # Audit costs for all servers
mastyf-ai audit --server github                 # Filter to a specific server
mastyf-ai audit --threshold-cost 0.01           # Exit 2 if total cost exceeds $0.01
```

Outputs per-server token usage, estimated cost (USD), and tool-level breakdown.

### `mastyf-ai health`

```bash
mastyf-ai health --all                          # Health-check all servers
mastyf-ai health --fail-on-overload              # Exit 1 if any server has tool overload
mastyf-ai health --threshold-latency 1000        # Exit 2 if latency exceeds 1000ms
```

Outputs per-server latency, success rate, tool count, and overload warnings.

### `mastyf-ai report`

```bash
mastyf-ai report --all                          # Full security-cost-health report
mastyf-ai report --format markdown              # Output as markdown
mastyf-ai report --format json                  # Output as JSON
mastyf-ai report --output mastyf-ai-report.md    # Write to file
mastyf-ai report --threshold-score 75           # Exit 2 if overall score below 75
```

Generates a comprehensive report with overall score (weighted: security 40%, health 30%, cost efficiency 30%).

### `mastyf-ai proxy`

```bash
mastyf-ai proxy --config ./mcp.json --policy ./default-policy.yaml --blocking-mode block
mastyf-ai proxy --policy ./policy.yaml --dry-run          # Simulate without activating
mastyf-ai proxy --auth-issuer https://accounts.google.com --auth-audience my-app
mastyf-ai proxy --auth-required                            # Fail-closed auth
```

Starts the transparent proxy. Policy modes: `audit` (passive), `warn` (flag only), `block` (active enforcement). With `--dry-run`, evaluates policy against historical call records without activating the proxy.

---

## Policy Engine

Policies are YAML files evaluated against every `tools/call` in real time. The pipeline normalizes payloads (decoding hex/unicode/URL/HTML entity obfuscation), performs semantic shell analysis, then evaluates rules in order.

```yaml
# default-policy.yaml
version: '1.0'
policy:
  mode: block
  default_action: block       # fail-closed — blocks anything not explicitly allowed

  rules:
    - name: block-shell-injection
      action: block
      patterns:
        - curl\s|wget\s
        - rm\s+-rf
        - ;\s*\w
        - '&&|\|\|'
        - \$\{
        - '`[^`]+`'
        - /etc/passwd|/etc/shadow

    - name: deny-dangerous-tools
      action: block
      tools:
        deny:
          - execute_command
          - bash
          - sh
          - eval
          - exec
          - system
          - spawn
          - fork
          - popen
          - source

    - name: rate-limit-tool-calls
      action: flag
      maxCallsPerMinute: 120

    - name: token-budget
      action: flag
      maxTokens: 50000
```

**Hot-reload:** Edit the YAML file — the policy engine swaps atomically without restarting the proxy.

**RBAC example:**
```yaml
    - name: admin-only-tool
      action: block
      tools:
        deny: [dangerous_operation]
      rbac:
        scopes: [admin]
        clientIds: [^trusted-agent-]
```

---

## MCP Server Integration

MCP Mastyf AI runs as a first-class MCP server, exposing security tools to AI assistants:

```json
{
  "mcpServers": {
    "mastyf-ai": {
      "command": "npx",
      "args": ["@mastyf-ai/server"]
    }
  }
}
```

**Available tools:**
- `scan_security` — CVE, auth, typo-squat, and secret scanning
- `audit_costs` — Token usage and cost estimation
- `check_health` — Latency, success rate, and tool count
- `full_report` — Complete security-cost-health report (JSON/markdown/text)

**Available resources:**
- `mastyf-ai://latest-scan` — Most recent security scan results

**Available prompts:**
- `audit-config` — Generates audit instructions for an MCP config

---

## Security Model

| Layer | What it catches |
|-------|----------------|
| **Payload normalization** | Hex escaping, Unicode escapes, URL encoding, HTML entities, shell obfuscation |
| **Regex triage** | Cross-tool chaining, privilege escalation, exfiltration URLs, stealth directives, Unicode obfuscation (38 patterns, 8 categories) |
| **Schema analysis** | Injection in parameter defaults, suspicious parameter names, enum injection |
| **Shell AST** | Command substitution, pipe chains, redirects, logical chains, 33 dangerous commands, Unicode homoglyphs |
| **LLM semantic** | Context-aware verdict on tool descriptions — catches adversarial intent regex can't see |
| **Secret patterns + entropy** | 50+ named patterns + Shannon entropy for base64/hex secrets |
| **Policy engine** | Tool denylists, regex patterns, rate limits, token budgets, RBAC, default-deny |
| **Response inspection** | Prompt injection in tool RESPONSES, data exfiltration URLs, base64-encoded payloads |

---

## Production Deployment

### Kubernetes (Helm)

```bash
helm repo add mastyf-ai https://mastyf-ai.github.io/mastyf-ai
helm install mastyf-ai mastyf-ai/mastyf-ai \
  --set persistence.enabled=true \
  --set metrics.enabled=true \
  --set secrets.mode=external \
  --set secrets.existingSecret=mastyf-ai-secrets
```

The Helm chart includes:
- **Liveness/readiness probes** (`/healthz`, `/readyz` on port 9090)
- **Resource limits** (CPU 100m–500m, memory 256Mi–512Mi)
- **Security context** (non-root, read-only root filesystem, all capabilities dropped)
- **NetworkPolicy** (intra-namespace proxy traffic, CIDR-restricted dashboard)
- **ExternalSecrets** support (Vault, SOPS)

### Docker

```bash
docker run -v $(pwd)/mcp.json:/etc/mastyf-ai/config.json \
  -v $(pwd)/policy.yaml:/etc/mastyf-ai/policy.yaml \
  ghcr.io/mastyf-ai/mastyf-ai:latest \
  proxy --config /etc/mastyf-ai/config.json --policy /etc/mastyf-ai/policy.yaml
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MASTYF_AI_DB_PATH` | `~/.mastyf-ai/history.db` | SQLite database path |
| `MASTYF_AI_SECRET_ALLOWLIST` | — | Comma-separated safe high-entropy strings |
| `MASTYF_AI_MAX_PAYLOAD_BYTES` | `10485760` (10 MB) | Max JSON-RPC payload size |
| `MASTYF_AI_SECRET_PROVIDER` | `env` | Secret backend: `env`, `hashicorp-vault`, `aws-secrets-manager` |
| `MASTYF_AI_ALLOW_MODE_OVERRIDE` | `false` | Allow CLI `--blocking-mode` to override policy file mode |
| `MASTYF_AI_STRICT_MODE` | `false` | Exit on Redis-not-configured in multi-replica/K8s |
| `METRICS_ENABLED` | `false` | Expose Prometheus metrics |
| `METRICS_PORT` | `9090` | Prometheus metrics port |
| `DASHBOARD_ENABLED` | `false` | Enable web dashboard |
| `DASHBOARD_PORT` | `4000` | Dashboard port |
| `DASHBOARD_METRICS_PUBLIC` | `false` | Allow unauthenticated metrics access |
| `REDIS_URL` | — | Redis connection for HA rate limiting and sessions |
| `ALERT_WEBHOOK_URL` | — | Slack or Discord webhook for critical alerts |
| `ALERT_MIN_SEVERITY` | `warning` | Minimum severity for webhook alerts |
| `ANTHROPIC_API_KEY` | — | API key for LLM semantic analysis layer |
| `MASTYF_AI_SEMANTIC_CIRCUIT_THRESHOLD` | `5` | Consecutive failures before semantic circuit opens |
| `MASTYF_AI_SEMANTIC_CIRCUIT_RESET_MS` | `60000` | Cooldown before half-open semantic probe |
| `MASTYF_AI_SEMANTIC_MAX_QUEUE` | `1000` | In-process concurrent semantic scan cap (per process/worker) |
| `MASTYF_AI_SEMANTIC_PER_TENANT_MAX` | `50` | Per-tenant semantic scan cap (in-process) |
| `MASTYF_AI_SEMANTIC_QUEUE_COORD` | — | Set to `parent` for worker-thread queue delegation hooks |
| `MASTYF_AI_SCAN_CONCURRENCY` | `32` | Parallel tool scans in `scanServer()` |
| `MASTYF_AI_SCAN_TOOL_TIMEOUT_MS` | LLM timeout + 5000 | Per-tool wall clock in `scanServer()` |
| `MASTYF_AI_SCAN_SERVER_BUDGET_MS` | `300000` | Total wall clock budget for `scanServer()` |
| `MASTYF_AI_SAFE_URL_HOSTS` | — | Extra comma-separated URL host suffixes allowed in tool descriptions (MCPG-R-020) |
| `MASTYF_AI_UNICODE_MAX_CHARS` | `16384` | Skip full TR39 confusables map above this description length |
| `MASTYF_AI_UNICODE_MAX_OPS_PER_MINUTE` | `2000` | Rate cap for full TR39 normalization per process |
| `MASTYF_AI_ARG_SCAN_MAX_CHARS` | `8192` | Max characters per argument string tested by regex scanners (ReDoS cap) |
| `MASTYF_AI_LOCAL_SEMANTIC` | `true` | Enable deterministic local heuristic fallback when LLM is unavailable |
| `MASTYF_AI_LOCAL_SEMANTIC_THRESHOLD` | `0.55` | Minimum aggregate confidence score before local heuristic issues are emitted |
| `MASTYF_AI_LEARNED_RULES_ENABLED` | `false` | Load runtime learned-rules JSON overlay into argument + local-semantic scanners |
| `MASTYF_AI_LEARNED_RULES_PATH` | `~/.mastyf-ai/learned-rules.json` | Overlay file path |
| `MASTYF_AI_LEARNED_RULES_MAX_TOTAL` | `200` | Maximum learned rules in overlay |
| `MASTYF_AI_LEARNED_RULES_RELOAD_MS` | `60000` | Periodic overlay reload interval (0 = load once at startup) |
| `MASTYF_AI_MANIFEST_SECRET` | — | **Required in production/strict mode.** HMAC secret for tool manifest pinning (min 32 chars). No hardcoded default is used. |
| `MASTYF_AI_MANIFEST_REQUIRE_SECRET` | `false` | When `true`, refuse file-based auto secret — require `MASTYF_AI_MANIFEST_SECRET` |
| `MASTYF_AI_MANIFEST_PATH` | `~/.mastyf-ai/tool-manifest.json` | Tool pinning manifest file path |

**Tool manifest pinning:** `verifyToolDefinitions()` / `approveToolDefinitions()` sign entries with HMAC-SHA256. Set `MASTYF_AI_MANIFEST_SECRET` explicitly in production (`MASTYF_AI_STRICT_MODE=true` enforces this). Local dev may use an auto-generated secret in `~/.mastyf-ai/.local-secret` (mode `0600`) when not in strict mode.
 Threat Lab discoveries promoted at runtime merge with static rules in `runArgumentScan()` (`MCPG-A-LRN-*`) and `runLocalSemanticFallback()` (`MCPG-LOC-LRN-*`). Each candidate passes ReDoS timing, true-positive probe match, and benign-corpus false-positive gates before append. Enable with `MASTYF_AI_LEARNED_RULES_ENABLED=true`; promotion from Threat Lab requires `MASTYF_AI_LEARNED_RULES_PROMOTE=true` on the proxy (confidence ≥ `MASTYF_AI_LEARNED_RULES_MIN_CONFIDENCE`, default 0.90).

**Local semantic fallback (`runLocalSemanticFallback`):** When no LLM key is configured or the semantic circuit is open, 80 bounded-regex heuristics (`MCPG-LOC-001`–`080`) cover instruction suppression, jailbreak (DAN, leetspeak), exfiltration (webhook, cloud CLI, git/scp, encode-then-transfer), credential theft, system-prompt injection, goal/memory poisoning, tool chaining, shell/meterpreter payloads, obfuscation, stealth, and multilingual attacks (FR/ES/DE/PT/IT/AR/JA/CJK). Each matching rule contributes its weight; all hits above the threshold are returned. Allowlisted documentation URLs are excluded from exfiltration rules.

**HTTP tool fetcher (`fetchToolsFromHttp`):** Each JSON-RPC request (`initialize`, `tools/list`) gets its own `timeoutMs` budget (default 10s). Optional `totalTimeoutMs` caps combined handshake time (default `timeoutMs * 2`). Connections are pooled per origin via undici `Agent` keep-alive. Streamable HTTP servers returning `mcp-session-id` on initialize have that header forwarded to `tools/list`.

**Argument layer (Layer 1b):** `runArgumentScan()` includes prompt-injection detection (`MCPG-A-PI-*`) on every string argument leaf, ported from the main-repo `INJECTION_RULES` in `src/scanners/prompt-injection-detector.ts`. Keep both rule sets in sync; `packages/core/tests/argument-pi-corpus.test.ts` enforces 32/32 recall on `corpus/attacks/prompt-injection/`.

| `NVD_API_KEY` | — | NIST NVD API key for CVE lookups |
| `MCP_PRICING_MODEL` | `gpt-4o` | Default model for cost estimation |

---

## Architecture

```
                    ┌──────────────────────────┐
                    │    MCP Mastyf AI Proxy     │
                    │  ┌────────────────────┐  │
 AI Client ──JSON-RPC→│  Policy Engine       │──→ Upstream MCP Server
                    │  │  (audit/warn/block) │  │         │
                    │  └────────┬───────────┘  │         │
                    │           │              │         │
                    │  ┌────────▼───────────┐  │         │
                    │  │  HistoryDatabase    │  │         │
                    │  │  (better-sqlite3    │  │         │
                    │  │   WAL + lockfile)   │  │         │
                    │  └────────────────────┘  │         │
                    └──────────────────────────┘         │
                                                        │
              ┌─────────────────────────────────────────┘
              │
    ┌─────────▼──────────┐    ┌──────────────┐    ┌──────────┐
    │  Security Scanner   │    │  Cost Auditor │    │  Health  │
    │  • CVE (OSV+NVD)   │    │  • tiktoken   │    │  Monitor │
    │  • Auth probing     │    │  • litellm    │    │  • JSON- │
    │  • Typo-squat       │    │  • per-model  │    │    RPC   │
    │  • Secret (50+      │    │    pricing    │    │    probe │
    │    + entropy)       │    │               │    │  • latency│
    │  • Command AST      │    └──────────────┘    └──────────┘
    │  • Response inspect │
    └────────────────────┘
```

### Data Flow
1. AI client sends `tools/call` JSON-RPC to proxy
2. Proxy extracts JWT identity → validates (algorithm-pinned, audience/issuer-checked)
3. Policy engine evaluates context (tool name, arguments, RBAC) → block/flag/pass
4. If passed, forwards to upstream MCP server; if blocked, returns JSON-RPC error
5. Records call metadata (tokens, duration, agent ID) to SQLite
6. Circuit breaker monitors upstream health; health probes run periodically
7. Dashboard receives real-time events via WebSocket; Prometheus scrapes `/metrics`

---

## Development

```bash
# Clone and install
git clone https://github.com/mastyf-ai/mastyf-ai.git
cd mastyf-ai
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Type-check
pnpm typecheck

# Run specific test suites
cd packages/core && npx vitest run
cd packages/server && npx vitest run
cd packages/cli && npx vitest run

# Run corpus evaluation
pnpm eval

# Development mode (hot-reload)
pnpm dev
```

---

## FAQ

### How is MCP Mastyf AI different from a WAF or API gateway?

A WAF inspects HTTP traffic patterns; MCP Mastyf AI operates at the **MCP protocol layer** — it understands `tools/call` semantics, tool names, argument schemas, and agent identities. It can block `execute_command` calls while allowing `read_file`, enforce per-tool rate limits, and validate JWT claims with algorithm pinning. It also scans MCP servers for CVEs, secrets, and typo-squatting — things a WAF cannot do.

### Does the proxy add latency?

Typically **5–25ms** for policy evaluation (regex + schema + semantic shell analysis). JWT validation adds another **5–15ms**. The total proxy overhead is under 50ms for most calls. If LLM semantic analysis is enabled, that adds 200–800ms per tool definition scan (not per call — it runs once during manifest verification, not on every intercepted request).

### Can I run it without blocking anything?

Yes. Set the policy mode to `audit`:

```yaml
policy:
  mode: audit
```

This logs every decision without blocking or flagging. Use it to understand what your agents are calling before enforcing rules. You can also run `mastyf-ai proxy --policy ./policy.yaml --dry-run` to simulate blocking against historical call records.

### What happens if the policy engine crashes?

The proxy does **not** pass traffic through if the engine is unavailable — it returns a JSON-RPC error to the client. This is intentional fail-safe behavior. The policy engine is a synchronous, in-process evaluator (no network calls for regex/schema rules), so crashes are extremely unlikely. The LLM semantic layer gracefully degrades to an info-level "skipped" result if the API is unreachable.

### Can I use it with multiple replicas?

Yes, with caveats. The proxy works single-instance or multi-replica, but **rate limiting and session state require Redis** (`REDIS_URL`) in multi-replica mode. Without Redis, rate limits are per-pod and session tokens from pod A are invalid on pod B. Set `MASTYF_AI_STRICT_MODE=true` to refuse startup if Redis is missing in a multi-replica/K8s environment. For the audit database, use separate DB paths (`MASTYF_AI_DB_PATH`) per instance, or migrate to PostgreSQL (planned for v2.4).

### Does the LLM semantic layer send my data to Anthropic?

Only if you configure `ANTHROPIC_API_KEY`. The semantic scanner sends **tool definitions** (name + description + inputSchema) to Claude for security analysis — never the actual tool call arguments or response content. Tool definitions are metadata, not user data. You can disable the semantic layer entirely with `--skip-semantic` or by not setting the API key.

### How do I add my own secret patterns?

Add them to the `MASTYF_AI_SECRET_ALLOWLIST` environment variable (comma-separated) to suppress false positives. For custom detection patterns, you can extend `src/scanners/secret-scanner.ts` and rebuild. The entropy threshold (`4.5` bits per character) is also configurable in source.

### Can I use it as a library in my own tool?

Yes. The `@mastyf-ai/core` package exports the detection engine directly:

```typescript
import { scanServer, fetchToolsFromStdio } from '@mastyf-ai/core';

const tools = await fetchToolsFromStdio({ command: 'npx', args: ['@my-mcp-server'] });
const result = await scanServer('my-server', tools, 'stdio');
// result.status: 'clean' | 'warning' | 'critical'
// result.tools: per-tool scan results with issues
```

The root package (`@mastyf-ai/server`) exports the full CLI, proxy, and MCP server.

### What's the default policy if I don't provide one?

The `default-policy.yaml` shipped with the package blocks shell injection patterns (curl, wget, rm -rf, command chaining, /etc/passwd), explicitly denies dangerous tools (execute_command, bash, sh, eval, exec, etc.), rate-limits at 120 calls/min, flags tokens over 50K, and applies `default_action: block` — meaning anything not explicitly allowed is blocked. You can override this with your own policy file.

### Does it work with Windows?

The TypeScript codebase is platform-agnostic, but the **stdio proxy** spawns child processes and uses Unix signal handling. Windows support via WSL2 is fully functional. Native Windows `cmd.exe` / PowerShell is experimentally supported but not the primary target. The HTTP/SSE proxy transport works on any platform.

### How do I get alerted when something gets blocked?

Set `ALERT_WEBHOOK_URL` to a Slack or Discord webhook URL, and optionally `ALERT_MIN_SEVERITY` (default: `warning`). The alerter fires on policy blocks, circuit breaker state changes, and cost threshold breaches. Messages include server name, rule triggered, and timestamp.

### Where is the database stored?

`~/.mastyf-ai/history.db` by default. Override with `MASTYF_AI_DB_PATH`. The database uses SQLite with WAL mode, advisory file locking, and automatic purging of records older than 30 days. For tests, pass `':memory:'` to use an in-memory database.

### How do I verify my policy before deploying?

Use dry-run mode:

```bash
mastyf-ai proxy --policy ./new-policy.yaml --dry-run
```

This evaluates the policy against every call record in your history database and prints a per-server block/pass breakdown without activating the proxy. If the block rate is unexpectedly high or low, adjust rules before deploying.

### How do AI clients authenticate with OAuth?

The proxy validates JWT bearer tokens in the `Authorization` header of `tools/call` requests. However, AI clients like Cline and Claude Desktop don't natively generate OAuth tokens. You have three options:

1. **Token injection via MCP config** — Set `env.AUTH_TOKEN` in your MCP server config. The proxy passes it as a Bearer token to upstream servers and validates it if `--auth-required` is set.
2. **API gateway pattern** — Place an OAuth proxy (e.g., oauth2-proxy, Pomerium) in front of Mastyf AI. The gateway issues tokens; MCP Mastyf AI validates them.
3. **Service account tokens** — Generate a long-lived service account JWT and configure it as `AUTH_TOKEN`. Rotate it manually or via vault.

RBAC scopes are defined in your policy YAML under `rules[].rbac.scopes` and mapped to JWT claims (the `scope` or `scopes` claim in the token). DPoP (RFC 9449) requires the client to sign a proof-of-possession JWT per request — this is functional in code but not yet supported by any mainstream AI client.

### How accurate is token counting?

For OpenAI models (GPT-4o, o1, o3), counting uses `tiktoken` with `o200k_base` encoding — these are exact (±1%). For other providers:

| Provider | Method | Typical accuracy |
|----------|--------|-----------------|
| Anthropic (Claude) | Char ratio (0.30) | ±5–15% |
| Google (Gemini) | Char ratio (0.22) | ±10–25% |
| DeepSeek | Char ratio (0.27) | ±8–20% |
| Mistral | Char ratio (0.25) | ±8–20% |
| Meta (Llama) | Char ratio (0.25) | ±8–20% |

Results are flagged with `isEstimate: true` when char-ratio counting is used. Treat non-OpenAI cost figures as estimates, not accounting-grade numbers.

### How does CVE scoring work? Why aren't 100 CVEs penalized more?

MCP Mastyf AI uses **logarithmic compound scoring**: each additional CVE in the same severity tier adds diminishing penalty. 1 critical CVE = −30, 2 = −60, 5 = −100, 10 = −130, 100 = −230. This prevents a single vulnerable package from zeroing the entire score while still scaling penalty with volume. CVE recency and EPSS (Exploit Prediction Scoring System) integration is planned for v2.4.

### How do I set up mTLS?

mTLS requires:

1. A Certificate Authority (CA) — you can use your existing PKI or create one with `openssl`
2. A client certificate for each upstream MCP server signed by that CA
3. The CA certificate configured in MCP Mastyf AI via environment variables

Set `MCP_TLS_CA_PATH=/path/to/ca.pem` and `MCP_TLS_CLIENT_CERT_PATH=/path/to/client.crt`, `MCP_TLS_CLIENT_KEY_PATH=/path/to/client.key` per server in your MCP config's `env` section. A `mastyf-ai certs init` helper command is planned for v2.4 to automate this.

### What happens if my policy YAML is malformed?

The proxy **fails closed** — malformed YAML causes a startup error and the proxy refuses to start. It does not silently fall back to the last good policy or default to audit mode. Use `--dry-run` to validate new policies before deploying:
```bash
mastyf-ai proxy --policy ./new-policy.yaml --dry-run
```

### How do I contribute?

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. The monorepo uses pnpm workspaces with turbo for build orchestration. Run `pnpm install && pnpm build && pnpm test` to verify your setup. All PRs must pass the 80% coverage threshold and the red-team corpus evaluation (F1 ≥ 85%).

### Is it production-ready?

MCP Mastyf AI is **production-grade for controlled environments** (single-instance or Redis-backed multi-replica with `MASTYF_AI_STRICT_MODE`). The database layer uses better-sqlite3 with WAL mode and advisory file locking — crash-safe and non-blocking. It handles the core use case — active policy enforcement with audit trails — reliably. For high-trust enterprise deployments, a third-party security audit is planned for v2.5. See [SECURITY.md](SECURITY.md) for details on our security posture.

---

## Roadmap

### v2.4
- PostgreSQL migration option for multi-replica deployments
- OPA/Rego policy integration
- Multi-user proxy (separate DB schemas per team)

### v2.5
- Third-party security audit (OAuth/JWT/RBAC/DPoP)
- Adversarial fuzzing CI pipeline
- Hosted SaaS pilot

### v3.0
- Plugin architecture for custom scanners
- gRPC transport support
- Real-time cost dashboards with budget alerts

---

## License

MIT — see [LICENSE](LICENSE).

---

**Built with TypeScript, better-sqlite3, pino, prom-client, jose, shell-quote, tiktoken, commander, chalk, and lru-cache.**