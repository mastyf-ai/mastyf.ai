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

**Version 2.5.3** hardens production defaults (CVE gate opt-in, dashboard auth fail-closed, proxy stderr logging). **2.5.0** added one-command IDE wrapping (`mcp-guardian wrap`), Docker Compose, PostgreSQL/Redis HA paths, OPA/Rego hooks, compliance docs, and production Helm hardening.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Real-World Integration (Cline, Cursor, Claude Code)](#real-world-integration-cline-cursor-claude-code)
- [Two Operating Modes](#two-operating-modes)
- [Features](#features)
- [Installation](#installation)
- [CLI Reference](#cli-reference)
- [Policy Engine & Rollout](#policy-engine--rollout)
- [Interactive TUI](#interactive-tui)
- [Docker Compose](#docker-compose)
- [Kubernetes (Helm)](#kubernetes-helm)
- [Environment Variables](#environment-variables)
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

### Security
- **Three-layer detection** — Regex (38 patterns) → schema analysis → optional LLM semantic verdict
- **YAML policy engine** — Allow/deny lists, regex, rate limits, token budgets, RBAC, argument field patterns, default-deny
- **Hot-reload policies** — File watcher swaps engine on YAML changes
- **50+ secret patterns** + Shannon entropy for encoded secrets
- **AST command validation** — 33 dangerous commands, homoglyph normalization
- **CVE scanning** — OSV.dev + NVD with transitive dependency scanning
- **Response inspection** — Prompt injection and exfiltration in tool responses
- **Typo-squatting detection** — Levenshtein distance vs known package names
- **OPA/Rego** — Optional `OPA_URL` for external policy decisions

### Authentication & Zero Trust
- **OAuth 2.1 / OIDC** — JWT validation with algorithm pinning, audience/issuer checks
- **DPoP** — RFC 9449 sender-constrained tokens
- **RBAC** — Scope and client-ID rules in policy YAML
- **mTLS** — Mutual TLS for proxy ↔ upstream
- **Dashboard auth** — JWT sessions, API keys, CSRF, rate-limited login

### Cost Governance
- **Real token counting** — `tiktoken` + char-ratio estimates per provider
- **Live pricing** — litellm-backed model costs
- **Per-tool breakdown** — Tokens, duration, USD for every intercepted call

### Health & Observability
- **Live JSON-RPC probes** — Latency, success rate, tool count
- **Circuit breaker** — CLOSED / OPEN / HALF_OPEN
- **Prometheus** — `/metrics`, `/healthz`, `/readyz` on port 9090
- **Web dashboard** — REST + WebSocket API on port 4000 (not a full browser SPA until v2.6)
- **Interactive TUI** — Terminal dashboard (security, cost, health, AI, audit); **primary live-ops UI in v2.5.x**
- **OpenTelemetry** — OTLP tracing
- **SIEM hooks** — Structured JSON (`policy_decision`, `tool_blocked`) via `MCP_GUARDIAN_SIEM_*`
- **Webhook alerting** — Slack/Discord for policy blocks

### Enterprise (v2.5)
- **PostgreSQL backend** — `DB_TYPE=postgres` + `DATABASE_URL` for shared audit store
- **Redis HA** — `REDIS_URL` for multi-replica rate limits and sessions (`GUARDIAN_STRICT_MODE`)
- **Tenant isolation** — `GUARDIAN_TENANT_ID`, admin API routes on dashboard
- **Policy audit trail** — `POLICY_AUDIT_ENABLED` JSONL change log
- **Compliance pack** — [docs/COMPLIANCE.md](docs/COMPLIANCE.md), [docs/PEN_TEST_SCOPE.md](docs/PEN_TEST_SCOPE.md)
- **Helm chart** — Redis subchart, ServiceMonitor, ExternalSecrets, PDB, backup CronJob
- **Docker Compose** — Guardian + Redis reference stack
- **Supply-chain CI** — SBOM, npm audit, GHCR image publish

### Architecture
- **pnpm monorepo** — `packages/core`, `packages/cli`, `packages/server`, root `src/`
- **better-sqlite3** — WAL mode, primary writer + read-only TUI observers on the same file, migrations, 30-day purge
- **Pluggable secrets** — env, HashiCorp Vault, AWS Secrets Manager
- **Graceful shutdown** — WAL checkpoint, connection flush

### Testing
- **250+ tests** — unit, integration, E2E proxy, fuzz, RBAC/OAuth
- **Red-team corpus** — precision/recall on poisoned payloads
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

### `mcp-guardian tui`

```bash
mcp-guardian tui
mcp-guardian tui --policy default-policy.yaml
mcp-guardian tui --dashboard-url http://localhost:4000
```

Keys: `1`–`8` tabs, `Tab` next, `r` refresh, `Esc` quit. AI tab: `n` next suggestion, `a` accept, `x` reject.

Reads **`MCP_GUARDIAN_DB_PATH`** (default `~/.mcp-guardian/history.db`) in **read-only** mode so it can run beside a live proxy. Polls every **1.5s**; connects to **`ws://127.0.0.1:4000/ws`** only when a proxy (or dashboard) is actually listening — otherwise you will see `WS off (poll 1.5s)`, which is normal.

---

## Policy Engine & Rollout

Policies are YAML evaluated on every `tools/call`. Pipeline: payload normalization → semantic shell analysis → rules (regex, tool deny, rate limits, RBAC).

```yaml
# default-policy.yaml (production — fail-closed)
policy:
  mode: block
  default_action: block   # tools not on allowlist are blocked
  semantic_shell: true
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

The TUI is the **primary live-ops UI in v2.5.x**. The browser dashboard on port 4000 is a **REST + WebSocket API** (metrics, audit, policy) — not a full SPA until v2.6. If you want a terminal view of what Guardian actually recorded, use the TUI.

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

- **Not a multi-proxy control plane.** One TUI process observes one SQLite file (or Postgres if configured). It does not discover other hosts or aggregate fleet-wide instances yet.
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

See [deploy/PRODUCTION.md](deploy/PRODUCTION.md) for scaling, HA, and disaster recovery.

```bash
docker run -v $(pwd)/mcp.json:/etc/mcp-guardian/mcp.json \
  -v $(pwd)/default-policy.yaml:/etc/mcp-guardian/policy.yaml \
  ghcr.io/rudraneel93/mcp-guardian:latest \
  proxy --config /etc/mcp-guardian/mcp.json --policy /etc/mcp-guardian/policy.yaml
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_GUARDIAN_DB_PATH` | `~/.mcp-guardian/history.db` | SQLite path |
| `DB_TYPE` | `sqlite` | Set `postgres` for shared store (requires optional `pg` package) |
| `DATABASE_URL` | — | PostgreSQL connection string when `DB_TYPE=postgres` |
| `REDIS_URL` | — | Required for multi-replica rate limits |
| `GUARDIAN_STRICT_MODE` | `false` | Fail startup without Redis in K8s |
| `GUARDIAN_TENANT_ID` | `default` | Tenant label for audit/rate limits |
| `GUARDIAN_DISALLOW_MODE_OVERRIDE` | `false` | Set `true` to ignore CLI `--blocking-mode` |
| `GUARDIAN_AI_ENABLED` | `true` | AI learning in proxy/TUI (`false` to disable) |
| `GUARDIAN_AI_ON_CLI` | `false` | Run learning on `scan`/`audit`/`health`/`report` |
| `GUARDIAN_AI_AUTO_APPLY` | `false` | Auto-apply high-confidence rules (`true` = risky) |
| `GUARDIAN_EXPERIMENTAL_AI` | — | Legacy alias for `GUARDIAN_AI_ENABLED=true` |
| `GUARDIAN_AI_USE_DB_SNAPSHOTS` | `false` | Fast learning cycles from DB only (no live OSV) |
| `GUARDIAN_AI_BLOCK_DEBOUNCE_MS` | `30000` | Debounce learning after proxy blocks (burst-friendly) |
| `GUARDIAN_AI_ATTACK_MIN_BLOCKS` | `3` | Min repeated blocks per rule+tool before attack suggestions |
| `GUARDIAN_TUI_SKIP_LEARNING` | `false` | TUI display-only (no learning cycle on poll) |
| `GUARDIAN_TUI_ACTIVE_WINDOW_MS` | `900000` (15m) | “ACTIVE” vs “IDLE” on Instances tab (recent call window) |
| `GUARDIAN_TUI_LLM` | `true` | Optional analyst note via LLM on Overview |
| `GUARDIAN_WS_ENABLED` | `true` (proxy) | WebSocket push at `/ws` for TUI |
| `GUARDIAN_DASHBOARD_URL` | `http://127.0.0.1:4000` | TUI WebSocket + metrics API base URL |
| `GUARDIAN_SKIP_PREFLIGHT_SCAN` | `false` | Skip background CVE scan on proxy start |
| `GUARDIAN_WORKSPACE` | — | Restrict filesystem tool paths to this directory (and subpaths) |
| `GUARDIAN_ALLOWED_PATH_PREFIXES` | — | Comma-separated path prefixes (alternative to `GUARDIAN_WORKSPACE`) |
| `GUARDIAN_GITHUB_ALLOWED_ORGS` | — | Comma-separated GitHub orgs allowed for `repo` arguments |
| `GUARDIAN_GITHUB_ALLOWED_REPOS` | — | Exact `org/repo` allowlist for GitHub tools |
| `GUARDIAN_PROXY_ENTROPY` | on in `block` mode | Block high-entropy / base64 blobs in tool arguments |
| `GUARDIAN_BLOCK_ON_CVE` | `false` | Opt-in: block tools/call on CVEs (default threshold CRITICAL) |
| `GUARDIAN_CVE_BLOCK_SEVERITY` | `CRITICAL` | When gate on: `HIGH` widens blocking |
| `DASHBOARD_AUTH_DISABLED` | `false` | Set `true` for local dev only (no API auth) |
| `DASHBOARD_API_KEY` | — | Required for dashboard API when auth on |
| `POLICY_AUDIT_ENABLED` | `false` | Policy change JSONL audit |
| `GUARDIAN_AUDIT_SYNC_ENABLED` | `false` | Sync SQLite → PostgreSQL |
| `OPA_URL` | — | OPA decision endpoint |
| `METRICS_ENABLED` | `false` | Prometheus on `METRICS_PORT` (9090) |
| `DASHBOARD_ENABLED` | `false` | Web UI on `DASHBOARD_PORT` (4000) |
| `DASHBOARD_ALLOWED_ORIGINS` | localhost | CORS origins |
| `MCP_GUARDIAN_SIEM_*` | — | SIEM export configuration |
| `ALERT_WEBHOOK_URL` | — | Slack/Discord alerts |
| `ANTHROPIC_API_KEY` | — | LLM semantic layer |
| `NVD_API_KEY` | — | NVD CVE lookups |

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
pnpm eval                 # red-team corpus
```

Monorepo layout: [packages/PACKAGING.md](packages/PACKAGING.md)

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

Set `REDIS_URL` and `GUARDIAN_STRICT_MODE=true`. Use PostgreSQL for shared audit (`DB_TYPE=postgres`).

### How do I verify policy before block mode?

```bash
mcp-guardian proxy --policy default-policy.yaml --dry-run
```

### How do I contribute?

See [CONTRIBUTING.md](CONTRIBUTING.md). Run `pnpm install && pnpm build && pnpm test`.

---

## Roadmap

### Shipped in v2.5
- `mcp-guardian wrap` for Cline/Cursor/Claude Desktop/Windsurf
- `guardian-configs/` + `guardian-proxy.sh` + policy rollout files
- Docker Compose + `docker-entrypoint.sh` volume permissions
- PostgreSQL, Redis sessions, OPA, tenant admin API
- Helm: Redis, ServiceMonitor, backup CronJob, developer example values
- TUI (read-only DB observer, per-server Instances tab, live analysis from `call_records`)
- `pnpm run live:tui-demo` for local multi-server smoke tests
- Compliance docs, supply-chain / GHCR CI

### v2.6 (planned)
- **Browser SPA** on existing `/api` + WebSocket (today: TUI + raw API only)
- Inbound HTTP/SSE gateway for remote MCP URLs
- Multi-proxy stdin routing fix (server-name metadata)
- Fleet / multi-instance aggregation (TUI today = single SQLite file)
- Enhanced SIEM exporters (Datadog/Splunk templates)
- `mcp-guardian certs init` for mTLS

### v3.0
- Multi-tenant control plane
- Plugin scanner architecture
- gRPC transport

---

## License

MIT — see [LICENSE](LICENSE).

---

**Docs:** [Real-world integration](docs/REAL_WORLD_INTEGRATION.md) · [Production](deploy/PRODUCTION.md) · [Compliance](docs/COMPLIANCE.md) · [Threat model](docs/THREAT_MODEL.md) · [Security](SECURITY.md)

**Built with** TypeScript, better-sqlite3, pino, prom-client, jose, commander, chalk, tiktoken, and the MCP SDK.
