# MCP Guardian

**Runtime security, cost governance, and health monitoring proxy for MCP infrastructure.**

[![npm version](https://img.shields.io/npm/v/@mcp-guardian/server)](https://www.npmjs.com/package/@mcp-guardian/server)
[![npm downloads](https://img.shields.io/npm/dm/@mcp-guardian/server)](https://www.npmjs.com/package/@mcp-guardian/server)
[![mcp-guardian MCP server](https://glama.ai/mcp/servers/rudraneel93/mcp-guardian/badges/score.svg)](https://glama.ai/mcp/servers/rudraneel93/mcp-guardian)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)](https://www.typescriptlang.org/)
[![MCP SDK](https://img.shields.io/badge/MCP_SDK-1.25-green)](https://github.com/modelcontextprotocol/typescript-sdk)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
[![CI](https://github.com/rudraneel93/mcp-guardian/actions/workflows/ci.yml/badge.svg)](https://github.com/rudraneel93/mcp-guardian/actions/workflows/ci.yml)

MCP Guardian sits between AI agents and MCP servers, enforcing **active security policies**, tracking **real token costs**, monitoring **server health**, and providing **enterprise observability** — all through a YAML-configurable engine with hot-reload.

It works as a **transparent stdio proxy** (real-time enforcement for Cline, Cursor, Claude Code), a **standalone CLI**, an **interactive TUI**, an **MCP audit server** (agents can self-scan), and a **pnpm monorepo** — install only what you need.

**Version 2.7.5** ships an **enterprise LLM/MCP attack corpus** (226 JSON fixtures under [`corpus/`](corpus/)), **CI corpus eval** (`pnpm eval` → `corpus-eval-report.json` on every PR + nightly), a **benchmarks** CI job (proxy latency; see [`benchmarks/README.md`](benchmarks/README.md)), **pen-test artifacts** ([`docs/PEN_TEST_REPORT.md`](docs/PEN_TEST_REPORT.md), [`security/ATTACK_MATRIX.md`](security/ATTACK_MATRIX.md)), and **adversarial E2E** ([`tests/e2e/adversarial-proxy.e2e.test.ts`](tests/e2e/adversarial-proxy.e2e.test.ts) — 10 corpus attacks through a live proxy). **2.7.4** adds a **Redis-backed LLM response cache** with in-memory LRU fallback ([`src/ai/llm-cache.ts`](src/ai/llm-cache.ts)) and **centralized `getLlmConfig()`** ([`src/config/llm-config.ts`](src/config/llm-config.ts)) — see [AI_LEARNING.md](docs/AI_LEARNING.md). **2.7.2** expands proxy-time secret DLP to **150+ detection patterns** (267 rules via `getSecretRuleCount()`). **2.7.0** ships Plugin SDK v3.0, browser dashboard SPA, fleet CLI, HTTP tools policy template, multi-region labels + Redis rate limits ([MULTI_REGION.md](docs/MULTI_REGION.md)), and async semantic audit metrics. **2.6.8** hardens policy from a [58-scenario adversarial report](tests/policy/adversarial-scenarios.test.ts). **2.5.0** added `mcp-guardian wrap`, Docker Compose, PostgreSQL/Redis HA paths, and Helm hardening.

> **Experimental vs shipped (honest)**  
> **Shipped:** stdio proxy, YAML policy + semantic guards, OPA block precedence, dashboard auth (fail-closed), **browser SPA** (`deploy/dashboard-spa/`), cost/token accounting, TUI + **Fleet tab**, Redis/Postgres HA, **detector Plugin SDK v3.0**, **fleet CLI**, HTTP tools template merge, **multi-region labeling** (active-passive — not active-active replication), async semantic audit (configurable + Prometheus), **Redis LLM response cache** + centralized LLM config (`getLlmConfig()`), **secret scanner DLP** (150+ patterns; `getSecretRuleCount()`), **enterprise corpus** (226 fixtures + `pnpm eval` CI gate), pen-test report + OWASP attack matrix, adversarial proxy E2E, AI learning with quorum/drift/rollback ([AI_LEARNING.md](docs/AI_LEARNING.md)), Windows `guardian-proxy.ps1`, Inno Setup script (`installer/windows/`).  
> **Roadmap:** multi-region **active-active** SQLite/Postgres replication, signed plugin marketplace, production MSI code-signing pipeline. AI learning remains batch/block-triggered — not per-attack instant ML.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Real-World Integration (Cline, Cursor, Claude Code)](#real-world-integration-cline-cursor-claude-code)
  - [Windows (native PowerShell)](#windows-native-powershell)
- [Two Operating Modes](#two-operating-modes)
- [Features](#features)
- [Installation](#installation)
- [CLI Reference](#cli-reference)
- [Policy Engine & Rollout](#policy-engine--rollout)
- [Interactive TUI](#interactive-tui)
- [Docker Compose](#docker-compose)
- [Kubernetes (Helm)](#kubernetes-helm)
- [Environment Variables](#environment-variables)
- [Production Checklist](#production-checklist)
- [Architecture](#architecture)
- [Development](#development)
- [FAQ](#faq)
- [Roadmap](#roadmap)
- [License](#license)

---

## Quick Start

```bash
# Install globally
npm install -g @mcp-guardian/server

# Scan all discoverable MCP configs (Cline, Cursor, Claude Desktop, Windsurf)
mcp-guardian scan --all

# Wrap IDE MCP servers for live proxy (audit mode first — safe rollout)
cd /path/to/mcp-guardian && npm run build
mcp-guardian wrap --client cline --policy policy-audit.yaml --apply

# Restart VS Code / reload MCP, then use Cline normally — traffic is proxied

# Interactive terminal dashboard
mcp-guardian tui

# Full report
mcp-guardian report --all --format markdown --output guardian-report.md
```

**Docker reference stack** (dashboard + Redis + proxy):

```bash
docker compose up --build
# Dashboard: http://localhost:4000  |  Metrics: http://localhost:9090/metrics
```

---

## Real-World Integration (Cline, Cursor, Claude Code)

AI clients spawn **one child process per MCP server** and speak JSON-RPC over **stdio**. MCP Guardian becomes that process: the IDE talks to Guardian; Guardian enforces policy and spawns the real upstream server as a child.

```
Cline / Cursor / Claude Code
        │  stdio JSON-RPC
        ▼
  scripts/guardian-proxy.sh  →  node dist/cli.js proxy
        │  policy + ~/.mcp-guardian/history.db
        ▼
  Real MCP server (npx @modelcontextprotocol/…)
```

### Critical rule: one Guardian process per MCP server

Wrap **each** server entry individually. Do not point the whole client at one proxy managing five backends (stdin routing is per-process).

| Client | Config path (macOS) |
|--------|---------------------|
| Cline (VS Code) | `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |
| Cursor / Claude Code | `~/.cursor/mcp.json` |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |

### One-command wrap

```bash
# Generate guardian-configs/<server>.json + example patched JSON
mcp-guardian wrap --client cline --policy policy-audit.yaml

# Patch live client config (creates timestamped .bak backup)
mcp-guardian wrap --client cline --policy policy-audit.yaml --apply

# Cursor / Claude Code
mcp-guardian wrap --client cursor --policy policy-warn.yaml --apply
```

**What wrap does:**

1. Reads your client MCP JSON
2. Writes upstream definitions to `guardian-configs/<server>.json` (one server each)
3. Replaces each entry’s `command` with `scripts/guardian-proxy.sh` and `--config` / `--policy` args
4. Skips `mcp-guardian` meta-server entries by default
5. Writes `examples/<config>.wrapped.json` for review

### Manual wrap (single server)

`guardian-configs/github.json` holds the **upstream** definition. Client entry:

```json
"github": {
  "command": "/absolute/path/mcp-guardian/scripts/guardian-proxy.sh",
  "args": [
    "--config", "/absolute/path/mcp-guardian/guardian-configs/github.json",
    "--policy", "/absolute/path/mcp-guardian/policy-audit.yaml"
  ],
  "transport": "stdio"
}
```

Use **absolute paths** — Cline’s working directory is unpredictable.

**Cline `env` note:** Cline often does not pass `env` from MCP JSON. Keep secrets in `guardian-configs/*.json`; use `guardian-proxy.sh` for `MCP_GUARDIAN_DB_PATH`, dashboard, and metrics env vars.

### Windows (native PowerShell)

On **win32**, `mcp-guardian wrap` uses `guardian-proxy.ps1` at the repo root and launches it via `powershell.exe -File` so paths like `C:\Users\John Doe\mcp-guardian` work. **WSL2** remains fully supported.

```powershell
pnpm build
mcp-guardian wrap --client cursor --policy policy-audit.yaml --apply
```

See **[docs/WINDOWS.md](docs/WINDOWS.md)** for Cursor example `mcp.json`, better-sqlite3 prebuild notes, and **[installer/windows/](installer/windows/)** for the Inno Setup MSI build (sign before org distribution).

### Policy rollout (production-safe)

| Phase | File | Behavior |
|-------|------|----------|
| 1 — observe | `policy-audit.yaml` | Log decisions, no blocks |
| 2 — alert | `policy-warn.yaml` | Flag violations, still forward |
| 3 — enforce | `default-policy.yaml` | Active block |

```bash
mcp-guardian proxy --policy default-policy.yaml --dry-run   # simulate against history DB
mcp-guardian wrap --client cline --policy default-policy.yaml --apply
```

Full guide: **[docs/REAL_WORLD_INTEGRATION.md](docs/REAL_WORLD_INTEGRATION.md)**

Verify integration: `./scripts/verify-live-integration.sh`

---

## Two Operating Modes

| Mode | How | What it does |
|------|-----|--------------|
| **Proxy** | `wrap` / `guardian-proxy.sh` / `mcp-guardian proxy` | Intercepts every `tools/call` for wrapped servers — **use this for Cline** |
| **MCP audit server** | `"command": "npx", "args": ["-y", "@mcp-guardian/server"]` | Agent can call `scan_security`, `audit_costs`, etc. — does **not** protect other MCP servers |

---

## Features

### Security & policy
- **Fail-closed production default** — `default-policy.yaml` sets `default_action: block` (tools not on the allowlist are blocked). Onboarding uses `policy-demo.yaml` (`default_action: pass`, `mode: audit`) — not for production.
- **Semantic guards** (sync, before YAML rules) — path guard (expanded credential paths: docker.sock, k8s service-account tokens, `terraform.tfstate`, `.npmrc`, `.git-credentials`, `.vault-token`, service-account JSON), **URL/SSRF guard** (`url-guard.ts`: metadata IPs `169.254.*`, `file://` / `javascript:` / `data:`, private RFC1918, decimal-IP localhost, `[::1]`, webhook/callback fields), SQL/NoSQL/GraphQL/LDAP exfil patterns, SSTI markers (`{{`, `${`, `<%`), GitHub write-tool deny, PowerShell guard, zero-width–stripped prompt-injection in tool **arguments** (`semantic-guards.ts`). See evaluation order in [POLICY.md](docs/POLICY.md).
- **Puppeteer / browser tools** — `puppeteer_navigate` and `puppeteer_screenshot` scan **all string leaves** for URLs, not only allowlisted tool names; blocks localhost/metadata/private targets while allowing benign public URLs (e.g. `https://example.com/`).
- **Adversarial regression** — 34 tests in [`tests/policy/adversarial-scenarios.test.ts`](tests/policy/adversarial-scenarios.test.ts) exercise the 58-scenario report against `default-policy.yaml` (no mocks); `tests/policy/url-guard.test.ts` covers URL parsing edge cases.
- **Honest limits (v2.6.8)** — Security depth improved, but orgs that add custom outbound tools (e.g. `http_request`) must add YAML URL/host rules or keep them off the allowlist. Built-in URL guard keys on `url` / `href` / `target` / `webhook` / `callback` plus full puppeteer argument trees — not every possible argument name.
- **Unicode / TR39** — `unicode_strict: true` loads `assets/confusables.txt` and folds confusables before regex (disable for literal Unicode in i18n teams)
- **Three-layer detection** — Regex → schema/shell tokenizer → optional async LLM semantic audit (not on the hot path)
- **YAML policy engine** — Allow/deny lists, regex, rate limits, token budgets, RBAC, argument field patterns
- **Hot-reload** — File watcher builds pending engine off-thread, atomic swap (no “reload in progress” blocks)
- **OPA/Rego precedence** — OPA **block** > YAML > `default_action`; OPA unavailable falls through to YAML ([POLICY.md](docs/POLICY.md))
- **`mcp-guardian policy test`** — CLI playground for one `tools/call` without starting the proxy
- **CVE gate (opt-in)** — `GUARDIAN_BLOCK_ON_CVE=false` by default; when `true`, blocks on scan severity (`GUARDIAN_CVE_BLOCK_SEVERITY`, default `CRITICAL`)
- **Secret / entropy DLP** — Proxy-time scan on every `tools/call` argument tree and tool **responses**; **150+** industry-standard secret patterns (**267** rules; `getSecretRuleCount()` in `src/scanners/secret-scanner.ts`) covering cloud (AWS, GCP, Azure), VCS/CI (GitHub, GitLab, Bitbucket), payments (Stripe, Square, PayPal), database URLs (postgres, mysql, mongodb, redis, amqp), AI provider keys (OpenAI, Anthropic, HuggingFace, Cohere), webhooks (Slack, Discord), crypto/OAuth, and generic high-entropy assignments; Shannon entropy in `block` mode (`GUARDIAN_PROXY_ENTROPY`)
- **Response inspection** — Prompt injection and exfiltration in tool **responses**
- **Detector plugins (SDK v3.0)** — `@mcp-guardian/plugin-sdk`, `GUARDIAN_PLUGIN_PATH`; on by default — [PLUGIN_SDK.md](docs/PLUGIN_SDK.md)
- **HTTP tools SSRF template** — `GUARDIAN_HTTP_TOOLS_POLICY=true` merges `policy-templates/http-tools-policy.yaml`
- **Fleet** — `mcp-guardian fleet status`; TUI Fleet tab; Postgres or `GUARDIAN_FLEET_DB_PATHS`
- **Dashboard SPA** — `http://localhost:4000/` when proxy runs (`DASHBOARD_ENABLED=true` for REST)

### Authentication & dashboard
- **Dashboard auth fail-closed** — When `DASHBOARD_ENABLED=true`, API requests are rejected unless `DASHBOARD_API_KEY` or `DASHBOARD_JWT_SECRET` is set. `DASHBOARD_AUTH_DISABLED=true` is for **local dev only** — do not expose to a network.
- **CSRF** — Double-submit cookie + `X-CSRF-Token` + Origin/Referer on mutating routes (skipped when auth disabled)
- **Session regeneration** — Successful login issues a fresh session token (`jti`) and revokes the prior cookie (session fixation mitigation)
- **OAuth 2.1 / OIDC** — JWT validation with algorithm pinning, audience/issuer checks (proxy path)
- **DPoP (RFC 9449)** — Sender-constrained tokens; **`jti` replay cache** rejects reused proof nonces (`src/auth/dpop.ts`)
- **RBAC** — Scope and client-ID rules in policy YAML
- **mTLS** — Mutual TLS for proxy ↔ upstream ([MTLS.md](docs/MTLS.md))

### AI learning (honest scope)
- **What it is** — Batch learning cycles plus **block-triggered** debounced runs (`GUARDIAN_AI_BLOCK_DEBOUNCE_MS`) after repeated policy blocks. It is **not** per-attack instant ML on every call.
- **Anti-poisoning** — Label quorum: `GUARDIAN_AI_MIN_DISTINCT_LABELERS` (default 2) or `GUARDIAN_AI_MIN_TOTAL_LABELS` (default 10); admin label weights; drift detection freezes auto threshold tuning until `GUARDIAN_AI_DRIFT_OVERRIDE=true`
- **Rollback** — `mcp-guardian ai rollback` and `POST /api/ai/rollback` restore the last learning snapshot; auto-rollback if precision proxy drops >10%
- **Human accept → policy** — TUI (`a` accept) or dashboard accept writes suggested rules to policy YAML (auto-apply off unless `GUARDIAN_AI_AUTO_APPLY=true`)
- **Centralized LLM config** — `getLlmConfig()` / `resolveModelId()` in [`src/config/llm-config.ts`](src/config/llm-config.ts) unify provider, model, token cap, timeout, and temperature for semantic scan, Ollama assistant, proxy cost path, and suggestion engine ([AI_LEARNING.md](docs/AI_LEARNING.md))
- **LLM response cache** — Deduplicates identical prompts across replicas (semantic scan + Ollama assistant). Enabled when `REDIS_URL` is set or `GUARDIAN_LLM_CACHE=true`; disable with `GUARDIAN_LLM_CACHE=false`. **Redis** backend when `REDIS_URL` is set (region-prefixed keys, configurable TTL); **in-memory LRU** fallback (500 entries) for single-replica or Redis outages. Cache key: SHA-256 of `model`, `system`, `prompt`, and `temperature`. Metrics: `mcp_guardian_llm_cache_hits_total` / `mcp_guardian_llm_cache_misses_total` (label `backend`: `redis` | `lru`). Implementation: [`src/ai/llm-cache.ts`](src/ai/llm-cache.ts)
- **Async semantic audit** — Post-hoc LLM queue when `GUARDIAN_LLM_ENABLED` + `GUARDIAN_SEMANTIC_ASYNC` (default on); sync path stays regex + semantic guards (&lt;50ms target)

### Cost governance
- **Provider-aware token counting** — OpenAI via `tiktoken`; Anthropic via optional `@anthropic-ai/tokenizer` or chars÷3.5; **counts are approximate unless the upstream response includes API `usage`** (`tokenSource: api | estimated`)
- **Multimodal** — Image tokens `(width × height) / 750` added to tool-call estimates
- **Live pricing** — litellm-backed model costs (USD only)
- **Per-tool breakdown** — Tokens, duration, USD for every intercepted call — see [docs/COST_GOVERNANCE.md](docs/COST_GOVERNANCE.md)

### Health & Observability
- **Live JSON-RPC probes** — Latency, success rate, tool count
- **Circuit breaker** — CLOSED / OPEN / HALF_OPEN
- **Prometheus** — `/metrics`, `/healthz`, `/readyz` on port 9090
- **Web dashboard** — Browser SPA at `http://localhost:4000/` when proxy runs (`deploy/dashboard-spa/`; REST + WebSocket; `GUARDIAN_DASHBOARD_SPA=false` for legacy HTML)
- **Interactive TUI** — Terminal dashboard (Overview–Fleet, nine tabs); complements the SPA for SSH-only or headless hosts
- **OpenTelemetry** — OTLP tracing
- **SIEM hooks** — Structured JSON (`policy_decision`, `tool_blocked`) via `MCP_GUARDIAN_SIEM_*`
- **Webhook alerting** — Slack/Discord for policy blocks

### HA & scale
- **PgBouncer required** — For **>50 replicas** or any multi-replica K8s with `DB_TYPE=postgres`; direct `:5432` exhausts `max_connections` under load. Set `GUARDIAN_REQUIRE_PGBOUNCER=true` to fail startup without a pooler URL. See [docs/SCALE_AND_RESILIENCE.md](docs/SCALE_AND_RESILIENCE.md)
- **Multi-region (active-passive)** — `GUARDIAN_REGION` labels metrics and Redis rate-limit keys; optional `GUARDIAN_RATE_LIMIT_DISTRIBUTED_LOCK`. Not active-active DB replication — see [MULTI_REGION.md](docs/MULTI_REGION.md). Redis locks still assume &lt;80ms RTT within a region.
- **PostgreSQL backend** — `DB_TYPE=postgres` + `DATABASE_URL` for shared audit store
- **Redis** — `REDIS_URL` for multi-replica rate limits and sessions (`GUARDIAN_STRICT_MODE`)

### IDE, remote & long-running dev
- **SQLite WAL + busy retry** — Shared `MCP_GUARDIAN_DB_PATH` between proxy and TUI; `persistCallRecord` retries `SQLITE_BUSY` (3× backoff, `busy_timeout=5000`)
- **Metrics lifecycle** — `shutdownMetrics()` on proxy/TUI/dashboard exit (clears maintenance intervals, closes `:9090`)
- **Remote SSH path map** — `GUARDIAN_REMOTE_SSH=true` + `GUARDIAN_REMOTE_PATH_MAP` translates local IDE paths for path-guard ([REMOTE_SSH.md](docs/REMOTE_SSH.md))
- **Dev containers** — Bind-mount the same `history.db`; see [DEVCONTAINERS.md](docs/DEVCONTAINERS.md)

### Enterprise (v2.5+)
- **Dashboard SPA (v2.7)** — `deploy/dashboard-spa/` served at `/` when the proxy runs with `DASHBOARD_ENABLED=true`; policy FP reject, AI accept/reject, fleet overview
- **Fleet aggregation (v2.7)** — `mcp-guardian fleet status` over Postgres `guardian_instances` or `GUARDIAN_FLEET_DB_PATHS`; TUI **Fleet** tab (key `9`)
- **Detector Plugin SDK v3.0 (v2.7)** — `@mcp-guardian/plugin-sdk` with `createDetectorPlugin` and lifecycle hooks; on by default — [PLUGIN_SDK.md](docs/PLUGIN_SDK.md), [packages/plugin-sdk/](packages/plugin-sdk/)
- **Tenant isolation** — `GUARDIAN_TENANT_ID`, admin API routes on dashboard
- **Policy audit trail** — `POLICY_AUDIT_ENABLED` JSONL change log
- **Compliance pack** — [docs/COMPLIANCE.md](docs/COMPLIANCE.md), [docs/PEN_TEST_SCOPE.md](docs/PEN_TEST_SCOPE.md)
- **Helm chart** — Redis subchart, ServiceMonitor, ExternalSecrets, PDB, backup CronJob
- **Docker Compose** — Guardian + Redis reference stack
- **Supply chain** — `better-sqlite3` **12.10+** (bundled SQLite 3.53.x), `jose` **6.x**, CI `pnpm audit --audit-level=high`, CycloneDX SBOM, cosign on GHCR — [SUPPLY_CHAIN.md](docs/SUPPLY_CHAIN.md)

### Architecture
- **pnpm monorepo** — `packages/core`, `packages/cli`, `packages/server`, root `src/`
- **better-sqlite3 12.10+** — WAL mode, primary writer + read-only TUI observers on the same file, migrations, 30-day purge
- **Pluggable secrets** — env, HashiCorp Vault, AWS Secrets Manager
- **Graceful shutdown** — WAL checkpoint, connection flush

### Testing
- **484+ tests** — `pnpm vitest run` (78 files; unit, integration, E2E proxy + adversarial proxy, fleet, policy-merge, plugin-sdk, llm-cache, llm-config, secret-scanner coverage)
- **Enterprise corpus** — **226** JSON fixtures ([`corpus/`](corpus/README.md)); `pnpm eval` via `PolicyEngine` + `default-policy.yaml` — **100% F1** on latest eval (see [`corpus-eval-report.json`](corpus-eval-report.json))
- **Pen-test evidence** — [`docs/PEN_TEST_REPORT.md`](docs/PEN_TEST_REPORT.md), OWASP MCP/LLM mapping in [`security/ATTACK_MATRIX.md`](security/ATTACK_MATRIX.md)
- **Adversarial scenarios** — 58+ inline regression tests ([`adversarial-scenarios.test.ts`](tests/policy/adversarial-scenarios.test.ts)); **10** corpus attacks through live proxy ([`adversarial-proxy.e2e.test.ts`](tests/e2e/adversarial-proxy.e2e.test.ts))
- **CI** — `corpus-eval` + `benchmarks` jobs in [`.github/workflows/ci.yml`](.github/workflows/ci.yml); nightly [`.github/workflows/corpus-eval.yml`](.github/workflows/corpus-eval.yml) uploads `corpus-eval-report.json`
- **Coverage gates** — 70% lines in CI

---

## Installation

```bash
# Global CLI
npm install -g @mcp-guardian/server

# As MCP audit server only
npx @mcp-guardian/server

# From source
git clone https://github.com/rudraneel93/mcp-guardian.git
cd mcp-guardian
pnpm install && pnpm build
```

**PostgreSQL (optional):** Default storage is SQLite. For `DB_TYPE=postgres`, install the optional driver: `pnpm add pg` (included as an optional dependency; dynamic import only when PostgreSQL is enabled).

---

## CLI Reference

### `mcp-guardian wrap` (new in v2.5)

```bash
mcp-guardian wrap --client cline              # auto-detect config
mcp-guardian wrap --client cursor --apply     # patch live ~/.cursor/mcp.json
mcp-guardian wrap --config ./mcp.json --policy default-policy.yaml
mcp-guardian wrap --skip github,mcp-guardian  # skip specific servers
```

### `mcp-guardian scan`

```bash
mcp-guardian scan --all
mcp-guardian scan --config ./mcp.json
mcp-guardian scan --fail-on-critical --fail-on-secrets --threshold-score 60
```

### `mcp-guardian audit` / `health` / `report`

```bash
mcp-guardian audit --all --server github
mcp-guardian health --all --fail-on-overload
mcp-guardian report --all --format markdown --output report.md
```

### `mcp-guardian proxy`

```bash
mcp-guardian proxy --config guardian-configs/github.json --policy default-policy.yaml
mcp-guardian proxy --policy ./policy.yaml --dry-run
mcp-guardian proxy --auth-issuer https://accounts.google.com --auth-audience my-app
```

Modes: `audit` | `warn` | `block`. Wrapper script: `scripts/guardian-proxy.sh` (sets DB path, dashboard, metrics).

Per-call sync evaluation stays fast (regex + semantic guards). When `GUARDIAN_LLM_ENABLED` is on, optional **async** LLM review runs post-hoc (`GUARDIAN_SEMANTIC_ASYNC=true`, default) and emits `async_semantic_flag` events without blocking JSON-RPC. Identical LLM prompts are deduplicated via the Redis + LRU cache ([AI_LEARNING.md](docs/AI_LEARNING.md#llm-response-cache-enterprise)).

### `mcp-guardian policy test`

Policy playground — evaluate one `tools/call` without starting the proxy:

```bash
mcp-guardian policy test \
  --policy default-policy.yaml \
  --tool read_file \
  --args '{"path":"/etc/passwd"}'
```

Output is JSON: `{ "action", "rule", "reason", "mode" }`.

### `mcp-guardian fleet status`

Aggregate replicas from Postgres (`DATABASE_URL` + `DB_TYPE=postgres`) or multiple SQLite files:

```bash
export GUARDIAN_FLEET_DB_PATHS="$HOME/.mcp-guardian/history.db,/data/replica-b/history.db"
mcp-guardian fleet status
mcp-guardian fleet status --json
```

### `mcp-guardian ai rollback`

Restore the previous AI learning snapshot (weights/thresholds) after a bad accept cycle or drift:

```bash
mcp-guardian ai rollback
```

Equivalent dashboard route: `POST /api/ai/rollback`.

### `mcp-guardian tui`

```bash
mcp-guardian tui
mcp-guardian tui --policy default-policy.yaml
mcp-guardian tui --dashboard-url http://localhost:4000
```

Keys: `1`–`9` tabs (Overview … Fleet), `Tab` next, `r` refresh, `Esc` quit. AI tab: `n` next suggestion, `a` accept, `x` reject.

Reads **`MCP_GUARDIAN_DB_PATH`** (default `~/.mcp-guardian/history.db`) in **read-only** mode so it can run beside a live proxy. Polls every **1.5s**; connects to **`ws://127.0.0.1:4000/ws`** only when a proxy (or dashboard) is actually listening — otherwise you will see `WS off (poll 1.5s)`, which is normal.

---

## Policy Engine & Rollout

Policies are YAML evaluated on every `tools/call`. Pipeline: recursive de-obfuscation → payload normalization (TR39 confusables → NFKC when `unicode_strict: true`) → **semantic guards** (path, SQL exfil, GitHub writes, prompt-injection in args) → semantic shell analysis → YAML rules (regex, tool deny, rate limits, RBAC) → OPA block (if configured) → `default_action`.

**Unicode homoglyphs:** Production policies ship with `unicode_strict: true` and load `assets/confusables.txt` (Unicode TR39) to fold lookalike letters (Greek, Cyrillic, Armenian, mathematical alphanumeric, small caps) before regex matching. Set `unicode_strict: false` in policy YAML for international teams that need literal Unicode in tool arguments. The asset resolves from `dist/` at `../assets/confusables.txt` (~728 KB).

False-positive tuning: reject a block via dashboard `POST /api/policy/fp/reject` with `{ "rule", "pattern" }` (or suggestion reject with `fpReject: true`). After **3** confirmations (`GUARDIAN_FP_WHITELIST_THRESHOLD`), the rule+pattern fingerprint is whitelisted in `~/.mcp-guardian/.fp-whitelist.json`.

```yaml
# default-policy.yaml (production — fail-closed)
policy:
  mode: block
  default_action: block   # tools not on allowlist are blocked
  semantic_shell: true
  unicode_strict: true   # TR39 confusables before NFKC; false in policy-demo.yaml
  rules:
    - name: block-shell-injection
      action: block
      patterns: [curl\s|wget\s, rm\s+-rf, \$\([^)]+\)]
    - name: deny-dangerous-tools
      action: block
      tools:
        deny: [execute_command, bash, sh, eval]
```

| Shipped file | `mode` | `default_action` | Use when |
|--------------|--------|------------------|----------|
| `policy-demo.yaml` | audit | pass | Local try-it / onboarding only |
| `policy-audit.yaml` | audit | pass | First week — observe only |
| `policy-warn.yaml` | warn | pass | Alert without blocking |
| `default-policy.yaml` | block | block | Production enforcement |

For a safe first run: `mcp-guardian proxy --policy policy-demo.yaml` (or `policy-audit.yaml`). Switch to `default-policy.yaml` before production.

**Hot-reload:** edit YAML while proxy runs — engine swaps atomically.

---

## Interactive TUI

The **browser SPA** (`deploy/dashboard-spa/`) is the default UI at `http://localhost:4000/` when the proxy runs with `DASHBOARD_ENABLED=true`. Use the **TUI** for SSH-only hosts, quick terminal checks, or when port 4000 is not exposed — both read the same `MCP_GUARDIAN_DB_PATH` and share the Fleet tab / `mcp-guardian fleet status` data.

```bash
pnpm run build
mcp-guardian doctor --policy default-policy.yaml   # DB path, policy, AI flags

# Terminal 1 — at least one wrapped proxy (or echo-test) writing history.db
mcp-guardian proxy --config mcp.json --policy default-policy.yaml

# Terminal 2 — dashboard (same DB, read-only)
pnpm run tui
```

### What the TUI shows (honestly)

| Tab | Source | Caveats |
|-----|--------|---------|
| Overview / Audit | `call_records` in SQLite | **Real data** from proxied `tools/call` only. No traffic → zeros. |
| Security | Latest `security_scans` per server | Scans can score **0/100** when CVE data is harsh — that is not “mock,” it is scan output. |
| Cost | Token fields on call records | **$0** until calls carry priced models/tokens. |
| Instances | One row per **MCP server name** in DB | Not “Guardian processes.” `echo-test` with scans but **no calls** still appears; **Servers w/ traffic** counts servers with `call_records` only. |
| Fleet (key `9`) | `getFleetStatus()` — Postgres or `GUARDIAN_FLEET_DB_PATHS` | Same data as `mcp-guardian fleet status`; aggregate replicas, not live host discovery. |
| AI Engine | Learning cycle + pending suggestions | **No fake TP/FP rates** until ≥5 labeled accept/reject outcomes. Suggestions can be **empty** on stable traffic (no anomalies). |
| FULL ANALYSIS | Rebuilt from DB when records exist | Ignores stale `~/.mcp-guardian/.ai-report.json` when live calls are present. |

### Live updates — what actually works

1. **Same database file.** TUI and proxy must use the **same** `MCP_GUARDIAN_DB_PATH`. If you see counts stuck at 21 while a script runs, check the demo/proxy log: it must say `history.db`, not `history-<pid>-<timestamp>.db`.
2. **WebSocket (fastest).** Start the proxy first (`GUARDIAN_WS_ENABLED=true` by default). TUI status should show **`WS live`**. Port **4000** must be free; otherwise the proxy runs without WS and the TUI polls only.
3. **Polling (fallback).** Read-only reopen every 1.5s picks up WAL commits from the proxy. Good enough for local dev; not a replacement for a shared Postgres tier in production.

### Multi-server traffic (local demo)

The stdio proxy handles **one MCP server per process**. Four servers in the wild means **four wrapped proxies** (or `wrap`), all pointing at the same `MCP_GUARDIAN_DB_PATH`.

For a **single-machine smoke test** without editing four configs:

```bash
# Terminal 1
pnpm run tui

# Terminal 2 — replays 21 corpus calls (pass + block) into the SAME history.db
pnpm run live:tui-demo                        # stream: ~1 call / 1.5s (watch counts climb)
node scripts/run-live-tui-demo.cjs            # one-shot burst (all 21 calls quickly)
```

This uses in-process proxies + `scenarios/dogfood/enterprise-mcp-stub.cjs` — **not** your real GitHub/Postgres MCP binaries. It proves policy + DB + TUI wiring; it does not prove your production MCP servers.

```bash
pnpm run dogfood    # sandboxed CI scenario (separate DB under scenarios/dogfood/sandbox)
```

**Do not** use `scripts/real-life-tui-prep.cjs` for “live” demos — it used to seed fake AI JSON; that seeding was removed. Prefer `live:tui-demo` or real proxy traffic.

### Limitations (read this before demoing to leadership)

- **Fleet view is aggregate-only.** `mcp-guardian fleet status` and the TUI Fleet tab read Postgres `guardian_instances` or comma-separated SQLite paths — not live discovery of remote hosts.
- **“6 inst” ≠ 6 live proxies.** The status bar counts **server names** known to the DB (calls + scans). Only **Servers w/ traffic** reflects tool calls.
- **WS off** is common if nothing listens on `:4000` or an old process holds the port — fix by stopping stray `node dist/cli.js proxy` processes, not by assuming the TUI is broken.
- **Learning while TUI is open** does not write to the DB (read-only). Run learning on the proxy process or restart TUI after `GUARDIAN_TUI_SKIP_LEARNING=true` if you only want display.
- **Docker:** bind-mount the same `history.db` into the container and the host TUI, or you will see different numbers on each side.

---

## Docker Compose

```bash
docker compose up --build
```

| Service | Port | Notes |
|---------|------|-------|
| mcp-guardian | 4000, 9090 | Proxy + dashboard + metrics |
| redis | 6379 | Rate-limit/session backing |

Volumes: `guardian-data` → `/data/history.db`. Config: `./mcp.json`, `./default-policy.yaml`. Entrypoint fixes volume permissions for non-root `appuser` (uid 1001).

**IDE note:** Cline on the host should use local `wrap` + `guardian-proxy.sh`, not stdio into the container. Use Compose for team demos, CI, and central observability.

---

## Kubernetes (Helm)

```bash
helm install guardian ./deploy/helm/mcp-guardian \
  -f deploy/helm/mcp-guardian/examples/developer-cline-values.yaml
```

Includes: Redis subchart, ServiceMonitor, ExternalSecrets, PDB, backup CronJob, `fsGroup: 1001`, `/readyz` probes.

```bash
# Team example values
deploy/helm/mcp-guardian/examples/developer-cline-values.yaml
```

See [deploy/PRODUCTION.md](deploy/PRODUCTION.md) for scaling and [docs/SCALE_AND_RESILIENCE.md](docs/SCALE_AND_RESILIENCE.md) for HA chaos-test results (PgBouncer required, cross-region limits).

```bash
docker run -v $(pwd)/mcp.json:/etc/mcp-guardian/mcp.json \
  -v $(pwd)/default-policy.yaml:/etc/mcp-guardian/policy.yaml \
  ghcr.io/rudraneel93/mcp-guardian:latest \
  proxy --config /etc/mcp-guardian/mcp.json --policy /etc/mcp-guardian/policy.yaml
```

---

## Environment Variables

Grouped by concern. Full behavior: linked docs and `src/` defaults.

### Policy & detection

| Variable | Default | Description |
|----------|---------|-------------|
| `OPA_URL` | — | OPA decision endpoint (block wins over YAML) |
| `GUARDIAN_WORKSPACE` | — | Restrict filesystem tool paths to this directory |
| `GUARDIAN_ALLOWED_PATH_PREFIXES` | — | Comma-separated path prefixes |
| `GUARDIAN_GITHUB_ALLOWED_ORGS` | — | Allowed GitHub orgs for `repo` arguments |
| `GUARDIAN_GITHUB_ALLOWED_REPOS` | — | Exact `org/repo` allowlist |
| `GUARDIAN_PROXY_ENTROPY` | on in `block` | Block high-entropy / base64 in arguments |
| `GUARDIAN_BLOCK_ON_CVE` | `false` | Opt-in CVE gate on `tools/call` |
| `GUARDIAN_CVE_BLOCK_SEVERITY` | `CRITICAL` | `HIGH` widens blocking when gate on |
| `GUARDIAN_PLUGINS_ENABLED` | on | Detector plugins (`false` to disable) |
| `GUARDIAN_PLUGIN_PATH` | — | Directory of `*.js` plugins |
| `GUARDIAN_HTTP_TOOLS_POLICY` | `false` | Merge `policy-templates/http-tools-policy.yaml` |
| `GUARDIAN_HTTP_TOOLS_POLICY_PATH` | — | Override template path |
| `GUARDIAN_SEMANTIC_ASYNC` | on w/ LLM | Post-hoc LLM audit (non-blocking) |
| `GUARDIAN_SEMANTIC_DEBOUNCE_MS` | `500` | Async semantic queue debounce |
| `GUARDIAN_SEMANTIC_ASYNC_MAX_QUEUE` | `200` | Max queued async audits |
| `GUARDIAN_SEMANTIC_MIN_CONFIDENCE` | `0.6` | Flag threshold for async semantic |
| `GUARDIAN_REGION` | `default` | Region label for metrics/Redis keys |
| `GUARDIAN_RATE_LIMIT_DISTRIBUTED_LOCK` | `false` | Redis NX window lock (active-passive) |
| `GUARDIAN_FLEET_DB_PATHS` | — | Comma-separated SQLite paths for fleet CLI/TUI |
| `GUARDIAN_DASHBOARD_SPA` | on | Serve `deploy/dashboard-spa/` at `/` |
| `GUARDIAN_FP_WHITELIST_THRESHOLD` | `3` | FP confirmations before auto-whitelist |
| `GUARDIAN_FP_WHITELIST_PATH` | `~/.mcp-guardian/.fp-whitelist.json` | FP whitelist file |
| `POLICY_AUDIT_ENABLED` | `false` | Policy change JSONL audit |
| `GUARDIAN_DISALLOW_MODE_OVERRIDE` | `false` | Ignore CLI `--blocking-mode` when `true` |

**URL guard (v2.6.8):** No dedicated env vars — runs inside semantic guards on every `tools/call`. Restrict filesystem access with `GUARDIAN_WORKSPACE` / `GUARDIAN_ALLOWED_PATH_PREFIXES` above.

### Auth & dashboard

| Variable | Default | Description |
|----------|---------|-------------|
| `DASHBOARD_ENABLED` | `false` | REST + WebSocket API on port 4000 |
| `DASHBOARD_AUTH_DISABLED` | `false` | `true` = local dev only (no auth) |
| `DASHBOARD_API_KEY` | — | API key / login shortcut when auth on |
| `DASHBOARD_JWT_SECRET` | — | HMAC session tokens |
| `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` | — | Dashboard login |
| `DASHBOARD_ALLOWED_ORIGINS` | localhost | CORS allowlist |
| `GUARDIAN_TENANT_ID` | `default` | Tenant label for audit/rate limits |

### AI learning

Full LLM cache and config reference: [AI_LEARNING.md](docs/AI_LEARNING.md) · implementation in [`src/config/llm-config.ts`](src/config/llm-config.ts) and [`src/ai/llm-cache.ts`](src/ai/llm-cache.ts).

| Variable | Default | Description |
|----------|---------|-------------|
| `GUARDIAN_AI_ENABLED` | `true` | Learning in proxy/TUI (`false` to disable) |
| `GUARDIAN_AI_AUTO_APPLY` | `false` | Auto-apply generated rules (`true` = risky) |
| `GUARDIAN_AI_ON_CLI` | `false` | Learning on `scan`/`audit`/`health`/`report` |
| `GUARDIAN_AI_BLOCK_DEBOUNCE_MS` | `30000` | Debounce after proxy blocks |
| `GUARDIAN_AI_ATTACK_MIN_BLOCKS` | `3` | Min blocks before attack suggestions |
| `GUARDIAN_AI_MIN_DISTINCT_LABELERS` | `2` | Quorum: distinct labelers |
| `GUARDIAN_AI_MIN_TOTAL_LABELS` | `10` | Quorum: weighted label total |
| `GUARDIAN_AI_DRIFT_OVERRIDE` | `false` | Unfreeze tuning after drift detection |
| `GUARDIAN_TUI_USER` | `$USER` | Label identity for quorum |
| `ANTHROPIC_API_KEY` | — | Anthropic API key (semantic layer) |
| `OPENAI_API_KEY` | — | OpenAI API key (when `GUARDIAN_LLM_PROVIDER=openai`) |
| `GUARDIAN_LLM_PROVIDER` | auto from keys | `anthropic` \| `openai` \| `ollama` (explicit override) |
| `GUARDIAN_LLM_MODEL` | provider default | Model id for semantic scan + Ollama assistant |
| `GUARDIAN_LLM_MAX_TOKENS` | `512` | `max_tokens` / `num_predict` cap |
| `GUARDIAN_LLM_TIMEOUT_MS` | `30000` | LLM HTTP timeout (ms) |
| `GUARDIAN_LLM_TEMPERATURE` | `0.1` | Sampling temperature (included in cache key) |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API base (`OLLAMA_URL` alias) |
| `GUARDIAN_LLM_CACHE` | on w/ `REDIS_URL` | `true` / `false` to force; otherwise on when `REDIS_URL` set. Redis + in-process LRU (500 entries); metrics `mcp_guardian_llm_cache_hits_total` / `mcp_guardian_llm_cache_misses_total` |
| `GUARDIAN_LLM_CACHE_TTL_SEC` | `3600` | Redis + LRU entry TTL (seconds) |

### Cost & observability

| Variable | Default | Description |
|----------|---------|-------------|
| `METRICS_ENABLED` | `false` | Prometheus on 9090 |
| `METRICS_MAINTENANCE_INTERVAL_MS` | `60000` | Registry refresh (cleared on shutdown) |
| `MCP_GUARDIAN_SIEM_*` | — | SIEM export |
| `ALERT_WEBHOOK_URL` | — | Slack/Discord on policy blocks |
| `NVD_API_KEY` | — | NVD CVE lookups |

### HA & database

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_GUARDIAN_DB_PATH` | `~/.mcp-guardian/history.db` | SQLite path |
| `DB_TYPE` | `sqlite` | `postgres` for shared store |
| `DATABASE_URL` | — | Postgres URL; **use PgBouncer** for multi-replica |
| `GUARDIAN_REQUIRE_PGBOUNCER` | `false` | Exit if URL is not pooler-shaped |
| `REDIS_URL` | — | Single Redis instance (multi-replica rate limits + LLM cache) |
| `REDIS_SENTINELS` | — | Comma `host:port` list + `REDIS_SENTINEL_MASTER_NAME` for Sentinel HA |
| `REDIS_CLUSTER_NODES` | — | Comma `host:port` list for Redis Cluster |
| `REDIS_PASSWORD` | — | Redis auth (all modes) |
| `GUARDIAN_STRICT_MODE` | `false` | Fail startup without Redis in K8s |
| `GUARDIAN_REQUIRE_DPOP` | `false` | Reject requests without valid DPoP proof (RFC 9449) |
| `GUARDIAN_DAILY_BUDGET_USD` | — | Daily spend cap tracked by CostAuditor (UTC midnight) |
| `GUARDIAN_AUDIT_SYNC_ENABLED` | `false` | Sync SQLite → PostgreSQL |

### Windows

| Variable | Default | Description |
|----------|---------|-------------|
| *(none required)* | — | Use `guardian-proxy.ps1` via `wrap` on win32; see [WINDOWS.md](docs/WINDOWS.md) |

### IDE & remote

| Variable | Default | Description |
|----------|---------|-------------|
| `GUARDIAN_REMOTE_SSH` | `false` | Map local paths for path-guard |
| `GUARDIAN_REMOTE_PATH_MAP` | — | JSON or `local=/remote` pairs |
| `GUARDIAN_WS_ENABLED` | `true` (proxy) | WebSocket `/ws` for TUI |
| `GUARDIAN_DASHBOARD_URL` | `http://127.0.0.1:4000` | TUI WS + API base |
| `GUARDIAN_TUI_SKIP_LEARNING` | `false` | TUI display-only |
| `GUARDIAN_SKIP_PREFLIGHT_SCAN` | `false` | Skip CVE scan on proxy start |

---

## Production Checklist

Short list before `default-policy.yaml` + block mode in production:

1. **Policy** — Roll out `policy-audit.yaml` → `policy-warn.yaml` → `default-policy.yaml`; run `mcp-guardian policy test` on risky tools; set `GUARDIAN_WORKSPACE` or path prefixes ([POLICY.md](docs/POLICY.md)).
2. **SSRF / browser tools** — Default policy blocks metadata IPs, dangerous schemes, and private/localhost URLs in `url`/`href`/`webhook`/`callback`; puppeteer tools get full-argument URL scan. If you add `http_request` or similar, add explicit YAML host/URL rules — allowlist alone is not enough.
3. **Credential paths** — Semantic path guard blocks docker.sock, k8s tokens, terraform state, `.npmrc`, `.git-credentials`, `.vault-token`, and service-account JSON patterns; scope writes with `GUARDIAN_WORKSPACE`.
4. **Auth** — `DASHBOARD_AUTH_DISABLED` must be **false** on any exposed dashboard; set `DASHBOARD_API_KEY` or JWT secret + credentials; production OAuth + `GUARDIAN_REQUIRE_DPOP=true` — [PRODUCTION_AUTH.md](docs/PRODUCTION_AUTH.md).
5. **HA** — `REDIS_URL` or Sentinel/Cluster ([REDIS_HA.md](docs/REDIS_HA.md)) + `GUARDIAN_STRICT_MODE=true` for multi-replica; `DATABASE_URL` through **PgBouncer**; `GUARDIAN_REQUIRE_PGBOUNCER=true` optional guardrail; single-region Redis only.
6. **Cost** — Merge `policy-templates/enterprise-cost-governance.yaml`; set `GUARDIAN_DAILY_BUDGET_USD` for daily USD tracking.
7. **CVE** — Decide explicitly: `GUARDIAN_BLOCK_ON_CVE=true` or leave off (default).
8. **AI** — Keep `GUARDIAN_AI_AUTO_APPLY=false`; configure quorum env vars if multiple operators label suggestions.
9. **Verify** — `pnpm eval` (enterprise corpus gate) before deploy; `mcp-guardian doctor`, `mcp-guardian proxy --dry-run`, shared `MCP_GUARDIAN_DB_PATH` for proxy + TUI; run `pnpm vitest run tests/policy/adversarial-scenarios.test.ts` after policy changes.
10. **Fleet** — Postgres `guardian_instances` or `GUARDIAN_FLEET_DB_PATHS` for `mcp-guardian fleet status` / TUI Fleet tab (aggregate only — not host discovery).
11. **Plugins** — Audit `GUARDIAN_PLUGIN_PATH`; set `GUARDIAN_PLUGINS_ENABLED=false` on hosts that must not load third-party detectors.
12. **HTTP tools** — Enable `GUARDIAN_HTTP_TOOLS_POLICY=true` when MCP servers expose outbound HTTP tools (merges `policy-templates/http-tools-policy.yaml`).
13. **Dashboard SPA** — `DASHBOARD_ENABLED=true` with auth credentials; use `GUARDIAN_DASHBOARD_SPA=false` only to fall back to legacy `deploy/dashboard.html`.
14. **mTLS** — `MCP_TLS_*` + Helm `mtls.enabled` for upstream mutual TLS ([PRODUCTION_AUTH.md](docs/PRODUCTION_AUTH.md)).

---

## Architecture

```
 AI Client (Cline/Cursor)
        │ stdio JSON-RPC
        ▼
 ┌──────────────────────────────┐
 │  guardian-proxy.sh           │
 │  ┌────────────────────────┐  │
 │  │ PolicyEngine           │  │──► block / flag / pass
 │  │ (audit/warn/block)     │  │
 │  └──────────┬─────────────┘  │
 │             │ forward          │
 │  ┌──────────▼─────────────┐  │
 │  │ Upstream MCP (child)   │  │
 │  └────────────────────────┘  │
 │  HistoryDatabase + metrics   │
 └──────────────────────────────┘
```

**Data flow:** client `tools/call` → JWT (optional) → policy → upstream or JSON-RPC error `-32001` → audit DB → dashboard/metrics/SIEM.

---

## Development

```bash
git clone https://github.com/rudraneel93/mcp-guardian.git
cd mcp-guardian
pnpm install && pnpm build && pnpm test
./scripts/verify-live-integration.sh
pnpm run dogfood          # sandboxed multi-server scenario (CI)
pnpm run live:tui-demo    # write shared ~/.mcp-guardian/history.db for TUI smoke test
pnpm eval                 # enterprise corpus (226 entries, PolicyEngine + default-policy)
pnpm exec tsx benchmarks/run.ts   # proxy latency benchmarks
node scripts/generate-pen-test-report.cjs   # docs/PEN_TEST_REPORT.md from eval output
```

### Test & evidence depth (v2.7.5)

| Asset | Count / scope |
|-------|----------------|
| Enterprise corpus | **226** JSON fixtures (`corpus/`) |
| Corpus categories | benign (55), prompt-injection (32), credential-exfil (23), sql-nosql (26), ssrf-url (26), shell-obfuscation (26), cross-tool-chain (16), edge-cases (22) |
| CI corpus eval | `pnpm eval` on every PR; artifact `corpus-eval-report.json` |
| CI benchmarks | p95 policy-eval gate (150ms, 100 iterations) |
| E2E proxy tests | `proxy-with-policy.e2e` + `adversarial-proxy.e2e` (10 attacks) |
| Pen-test docs | [docs/PEN_TEST_REPORT.md](docs/PEN_TEST_REPORT.md), [security/ATTACK_MATRIX.md](security/ATTACK_MATRIX.md) |

Monorepo layout: [packages/PACKAGING.md](packages/PACKAGING.md)

**Supply chain:** `pnpm-lock.yaml` is committed; use `pnpm install --frozen-lockfile`. CI runs `pnpm audit --audit-level=high` and publishes CycloneDX SBOMs. npm releases use `--provenance` on version tags; GHCR images are cosign-signed. We do **not** claim SLSA Level 3 yet — see [docs/SUPPLY_CHAIN.md](docs/SUPPLY_CHAIN.md).

---

## FAQ

### How do I connect Cline in real time?

Run `mcp-guardian wrap --client cline --policy policy-audit.yaml --apply`, restart VS Code, use Cline normally. See [docs/REAL_WORLD_INTEGRATION.md](docs/REAL_WORLD_INTEGRATION.md).

### How is this different from a WAF?

MCP Guardian understands `tools/call`, tool names, argument schemas, and MCP server CVEs — not just HTTP patterns.

### Does the proxy add latency?

Typically **5–25ms** per call for regex/schema policy (JWT +5–15ms). LLM semantic runs at manifest time, not per call.

### Can I run without blocking?

Use `policy-audit.yaml` or set `mode: audit` in your policy file.

### Cline and OAuth?

Clients don’t send JWTs natively. Use audit mode, `AUTH_TOKEN` in `guardian-configs/*.json`, or an API gateway in front of Guardian.

### TUI vs Docker database?

TUI reads `~/.mcp-guardian/history.db` (or `MCP_GUARDIAN_DB_PATH`). Docker uses `/data` unless you bind-mount the **same file** into the container and host. Different paths = different numbers — not a sync bug.

### Why does the TUI show 0 records or frozen counts?

Usually one of:

1. **Wrong DB file** — another process wrote to `history-<pid>-<timestamp>.db` while the TUI reads `history.db`. Run `mcp-guardian doctor`, check the TUI footer `DB:` line, and ensure proxy/demo/proxy logs reference the same path.
2. **No proxied traffic yet** — scan-only data does not create `call_records`. Run a wrapped server or `pnpm run live:tui-demo`.
3. **Stale build** — `pnpm run build` after pulling; the TUI runs `dist/cli.js`, not TypeScript sources.
4. **Port 4000 busy** — proxy skips dashboard/WS; TUI falls back to polling (still works if the DB is shared).

### Why does FULL ANALYSIS disagree with the summary?

Older builds cached text in `~/.mcp-guardian/.ai-report.json` from a single-server run. Current builds regenerate analysis from the DB when `call_records` exist. Delete `.ai-report.json` if you still see mismatches after upgrading.

### Multi-replica?

Set `REDIS_URL` and `GUARDIAN_STRICT_MODE=true`. Use PostgreSQL for shared audit (`DB_TYPE=postgres`) with **PgBouncer** in front (direct `:5432` exhausts `max_connections` under load). Optional: `GUARDIAN_REQUIRE_PGBOUNCER=true`. **Do not** run Redis active-active across regions (>80ms RTT breaks locks). See [docs/SCALE_AND_RESILIENCE.md](docs/SCALE_AND_RESILIENCE.md).

### How do I verify policy before block mode?

```bash
mcp-guardian proxy --policy default-policy.yaml --dry-run
```

### How do I contribute?

See [CONTRIBUTING.md](CONTRIBUTING.md). Run `pnpm install && pnpm build && pnpm test`.

---

## Roadmap

### Shipped in v2.7.5
- **Enterprise corpus** — 226 attack/benign/edge fixtures under `corpus/`; [`corpus/README.md`](corpus/README.md), [`corpus/manifest.yaml`](corpus/manifest.yaml)
- **Corpus eval** — `corpus/run-eval.ts`, `pnpm eval`, per-category precision/recall; CI fails on missed attacks; artifact `corpus-eval-report.json`
- **Benchmarks in CI** — `benchmarks/run.ts` job; p95 gate via `BENCH_P95_THRESHOLD_MS` ([`benchmarks/README.md`](benchmarks/README.md))
- **Adversarial E2E** — `tests/e2e/adversarial-proxy.e2e.test.ts` (live proxy + 10 corpus attacks)
- **Pen-test artifacts** — [`docs/PEN_TEST_REPORT.md`](docs/PEN_TEST_REPORT.md), [`security/ATTACK_MATRIX.md`](security/ATTACK_MATRIX.md), `scripts/generate-pen-test-report.cjs`

### Shipped in v2.7.4
- **Redis LLM cache** — [`src/ai/llm-cache.ts`](src/ai/llm-cache.ts): Redis-backed responses with in-memory LRU fallback; SHA-256 keys over `model + system + prompt + temperature`; Prometheus `mcp_guardian_llm_cache_hits_total` / `mcp_guardian_llm_cache_misses_total`
- **Centralized LLM config** — [`src/config/llm-config.ts`](src/config/llm-config.ts): `getLlmConfig()`, `resolveModelId()`; env `GUARDIAN_LLM_PROVIDER`, `GUARDIAN_LLM_MODEL`, `GUARDIAN_LLM_MAX_TOKENS`, `GUARDIAN_LLM_TIMEOUT_MS`, `GUARDIAN_LLM_TEMPERATURE`, `OLLAMA_BASE_URL` ([AI_LEARNING.md](docs/AI_LEARNING.md))

### Shipped in v2.7.2
- **Secret scanner** — 150+ patterns (267 rules; `getSecretRuleCount()`), pre-compiled rules in `src/scanners/secret-rules.ts`; proxy-time DLP on arguments and responses; [`tests/secret-scanner-coverage.test.ts`](tests/secret-scanner-coverage.test.ts)

### Shipped in v2.7.0
- **Plugin SDK v3.0** — `@mcp-guardian/plugin-sdk`, plugins on by default
- **Dashboard SPA** — `deploy/dashboard-spa/` at `/` (REST + WebSocket)
- **Fleet** — `mcp-guardian fleet status`, TUI Fleet tab, Postgres or `GUARDIAN_FLEET_DB_PATHS`
- **HTTP tools policy template** — `GUARDIAN_HTTP_TOOLS_POLICY`
- **Multi-region labels** — `GUARDIAN_REGION`, Redis per-region keys ([MULTI_REGION.md](docs/MULTI_REGION.md), active-passive)
- **Async semantic audit** — queue cap, min confidence, Prometheus `mcp_guardian_semantic_audit_*` ([AI_LEARNING.md](docs/AI_LEARNING.md))
- **Windows installer script** — Inno Setup `installer/windows/mcp-guardian.iss` (build and sign locally)

### Shipped in v2.6.x
- **2.6.8** — URL/SSRF guard, expanded path/credential patterns, SQL/NoSQL/LDAP/GraphQL/SSTI hardening, puppeteer URL validation, 58-scenario adversarial regression tests
- **2.6.7** — GDPR Article 17 `eraseAllAuditData`, cost-pricing recursion fix
- OPA block precedence, non-blocking policy hot-reload
- Windows `guardian-proxy.ps1` + `wrap` on win32
- PgBouncer mandatory guidance (>50 replicas / multi-replica Postgres)
- AI quorum, drift detection, `mcp-guardian ai rollback`
- Dashboard CSRF, session regeneration, fail-closed auth
- DPoP `jti` replay protection (Redis `jti` dedup when `REDIS_URL` set)
- Metrics dispose, SQLite busy retry, Remote SSH path map

### Planned
- **Multi-region active-active** — SQLite/Postgres replication across regions (today: labels + active-passive Redis only)
- **Signed plugin marketplace** — curated third-party detector distribution
- **Production MSI pipeline** — org code-signing and CI for Windows installers (script ships in v2.7)
- **Inbound HTTP/SSE gateway** — non-stdio MCP ingress
- **Enhanced SIEM templates** — richer export mappings
- **v3.0** — Multi-tenant control plane; gRPC transport

---

## License

MIT — see [LICENSE](LICENSE).

---

**Docs:** [Real-world integration](docs/REAL_WORLD_INTEGRATION.md) · [Policy](docs/POLICY.md) · [Corpus](corpus/README.md) · [Pen-test report](docs/PEN_TEST_REPORT.md) · [Attack matrix](security/ATTACK_MATRIX.md) · [Benchmarks](benchmarks/README.md) · [Plugin SDK](docs/PLUGIN_SDK.md) · [Multi-region](docs/MULTI_REGION.md) · [AI learning](docs/AI_LEARNING.md) · [Adversarial scenarios](tests/policy/adversarial-scenarios.test.ts) · [Cost governance](docs/COST_GOVERNANCE.md) · [Scale & resilience](docs/SCALE_AND_RESILIENCE.md) · [Windows](docs/WINDOWS.md) · [Windows installer](installer/windows/) · [Remote SSH](docs/REMOTE_SSH.md) · [Dev containers](docs/DEVCONTAINERS.md) · [Extensibility](docs/EXTENSIBILITY.md) · [Supply chain](docs/SUPPLY_CHAIN.md) · [Production](deploy/PRODUCTION.md) · [Compliance](docs/COMPLIANCE.md) · [Threat model](docs/THREAT_MODEL.md) · [Security](SECURITY.md)

**Built with** TypeScript, better-sqlite3 12.10+, pino, prom-client, jose 6.x, commander, chalk, tiktoken, and the MCP SDK.
