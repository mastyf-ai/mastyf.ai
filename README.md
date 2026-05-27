# MCP Guardian

**A security layer that sits between your AI agent and its tools — so nothing bad gets through.**

[![npm version](https://img.shields.io/npm/v/@mcp-guardian/server)](https://www.npmjs.com/package/@mcp-guardian/server)
[![npm downloads](https://img.shields.io/npm/dm/@mcp-guardian/server)](https://www.npmjs.com/package/@mcp-guardian/server)
[![Website](https://img.shields.io/badge/Website-mcp--guardian--cloud.vercel.app-0070f3)](https://mcp-guardian-cloud.vercel.app/)
[![mcp-guardian MCP server](https://glama.ai/mcp/servers/rudraneel93/mcp-guardian/badges/score.svg)](https://glama.ai/mcp/servers/rudraneel93/mcp-guardian)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)](https://www.typescriptlang.org/)
[![MCP SDK](https://img.shields.io/badge/MCP_SDK-1.25-green)](https://github.com/modelcontextprotocol/typescript-sdk)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
[![CI](https://github.com/rudraneel93/mcp-guardian/actions/workflows/ci.yml/badge.svg)](https://github.com/rudraneel93/mcp-guardian/actions/workflows/ci.yml)

**Version 3.3.0** · [Website](https://mcp-guardian-cloud.vercel.app) · [npm](https://www.npmjs.com/package/@mcp-guardian/server) · [Changelog](CHANGELOG.md)

### Detection tiers (honest)

| Path | Community | Enterprise (`GUARDIAN_ENTERPRISE_MODE=true`) |
|------|-----------|-----------------------------------------------|
| Request (`tools/call`) | Regex + schema | + sync semantic request gate (default when LLM configured) |
| Response | Optional sync gate | Sync response gate (production default) |
| Audit / learning | Opt-in async | Opt-in async |

See [ENTERPRISE_DEPLOYMENT.md](docs/ENTERPRISE_DEPLOYMENT.md) for Redis, multi-replica, and license requirements.

---

## What's new in 3.3.0

- **Production premortem remediation** — rug-pull on all `tools/list` responses (including JSON-RPC with `id`), inflight cap before policy/LLM, opt-in policy eval cache (`cacheable` in YAML), enterprise sync semantic request gate, cross-transport parity (stdio, HTTP, WebSocket, SSE, streamable HTTP)
- **Enterprise hardening** — shared Redis rug-pull alerts, license bypass lockdown in enterprise mode, encoding-guard union for base64 paraphrase attacks, session-flow backend metrics
- **Enterprise deployment guide** — [ENTERPRISE_DEPLOYMENT.md](docs/ENTERPRISE_DEPLOYMENT.md)
- **Ops** — `DELETE /api/internal/rug-pull` for clearing cluster rug-pull flags; `semanticRequestGate` on dashboard `/api/health`

## What's new in 3.2.8

- **Dashboard v3** — workspace navigation (Protection, Activity, Threats, Security, Operations, Settings, Help)
- **Operations analytics** — live traffic, error rate, and cost charts (`GET /api/analytics/summary`)
- **Security dashboard** — score, active threats, quarantine (`GET /api/security/dashboard`)
- **Guardian Autopilot** — `mcp-guardian autopilot` init/start/status; scheduled digests and background learning
- **Full analysis** — `pnpm analyze` and Protection workspace plain-English briefing
- **Setup checklist** — guided install, DB health, and cloud control plane connect APIs
- **Shared DB for live tests** — `real-life:*` runners honor `MCP_GUARDIAN_DB_PATH` so attack traffic appears in the dashboard
- **SOC panel refactor** — modular SOC/live panels, enterprise layout, design tokens

---

## What is it?

When you use an AI assistant (like Claude, Cursor, or Cline), it connects to tool servers — things like GitHub, a database, your filesystem, or Slack. These connections use a standard called **MCP (Model Context Protocol)**.

The problem: there's nothing stopping the AI from making dangerous tool calls, leaking secrets, running commands it shouldn't, or burning through your API budget without you knowing.

**MCP Guardian** sits in the middle. Every tool call the AI makes passes through Guardian first. Guardian checks it against your rules and either lets it through, blocks it, or flags it for review — before anything happens.

```
Your AI assistant
       │
       ▼
  MCP Guardian  ◄── checks every call against your rules
       │
       ▼
  Your tool servers (GitHub, filesystem, database...)
```

---

## Features

### Free (community)

- **Policy proxy** — every tool call is checked against YAML rules before it reaches your MCP servers
- **Policy rules** — allow/deny tools, argument patterns, rate limits, token budgets, hot-reload
- **Attack blocking** — shell commands, path traversal, SQL injection, secrets, SSRF, and Unicode tricks
- **CVE & typo-squat scanning** — checks MCP packages for known vulnerabilities and suspicious names
- **Cost tracking** — per-call USD and tokens, burn rate, budgets, and history
- **Health monitoring** — latency, success rate, circuit breakers, and tool inventory per server
- **Live audit log** — every block and pass stored in local SQLite (`history.db`)
- **Adversarial harness** — 800+ offline policy tests (`pnpm harness`)
- **Real-life scenarios** — live MCP attack streams against a real filesystem server (`pnpm real-life:filesystem`)

### Pro

- **Enterprise dashboard** — live SOC UI at :4000 with Protection, Activity, Threats, Security, Operations, and Settings workspaces
- **Operations analytics** — traffic, error rate, and cost charts from real proxy traffic
- **Security dashboard** — security score, active threats, and quarantine actions
- **Guardian Autopilot** — one-command wrap, proxy, dashboard, digests, and background learning
- **Full analysis** — plain-English security and health report (`pnpm analyze`)
- **Security Swarm** — autonomous AI agents that continuously red-team your setup and discover new attack patterns
- **Threat Lab** — LLM-powered threat discovery (uses local Ollama or cloud LLM)
- **Auto Threat Research** — background attack-library research from live blocks and semantic flags
- **Semantic audit** — async LLM review of tool arguments for evasion and injection
- **Fleet management** — manage multiple Guardian instances across servers
- **Enterprise deployment** — Kubernetes Helm chart, PostgreSQL backend, multi-tenancy, SSO

> Pro requires a license in production. Local dev: `pnpm dashboard:proxy`. See [PRO_SETUP.md](docs/PRO_SETUP.md) and [AUTOPILOT.md](docs/AUTOPILOT.md).

---

## How it works

1. You install MCP Guardian
2. Guardian wraps your existing MCP server configs (it finds them automatically in Cline, Claude Desktop, Cursor, etc.)
3. Every tool call now goes through Guardian first
4. Guardian checks the call against your policy rules
5. If it passes: the call goes to the real server and the response comes back
6. If it's blocked: the AI gets told the call was denied — nothing reaches the real server
7. Everything is logged to a local SQLite database (`~/.mcp-guardian/history.db` by default, WAL mode)
8. The dashboard reads from that database via REST and WebSocket and shows live KPIs, audit, and security views

```
AI client or attack runner
        │
        ▼
  Guardian proxy (policy + semantic + learning)
        │
        ├──► upstream MCP server(s)
        │
        └──► history.db ──► Dashboard :4000 (Analytics, Security, Audit)
```

---

## Quick Setup

### Install

```bash
npm install -g @mcp-guardian/server
```

### Onboard (one command — sets everything up)

```bash
mcp-guardian onboard
```

This finds your MCP configs (Cline, Claude Desktop, Cursor, Windsurf), wraps the servers, and sets up Guardian as the proxy. Takes about 30 seconds.

### Or run manually

```bash
# Start the proxy with the default policy
mcp-guardian proxy --policy default-policy.yaml
```

### Open the dashboard (recommended)

From the repo root after `pnpm build`:

```bash
pnpm dashboard:proxy
# optional: pnpm dashboard:proxy -- guardian-configs/filesystem.json default-policy.yaml
```

Open **http://localhost:4000/** — static SPA + `/api/*` + `/ws` are served by the same proxy process. Traffic you send through Guardian is reflected in **Operations → Analytics** and **Security → Dashboard**.

**Autopilot (wrap + dashboard + background services):**

```bash
pnpm autopilot:init -- --apply
pnpm autopilot:start
```

**Legacy dev split** (Next.js on :3000 proxying to :4040): `pnpm soc:full` — see [SOC-API.md](SOC-API.md).

### Test with live attack traffic (real MCP, not synthetic UI)

Prove end-to-end analytics with a **second terminal** while `dashboard:proxy` stays running:

```bash
export MCP_GUARDIAN_DB_PATH="$HOME/.mcp-guardian/history.db"
export MCP_GUARDIAN_HOME="$HOME/.mcp-guardian"
export REAL_LIFE_METRICS_ENABLED=false   # avoid :9090 clash with dashboard proxy

pnpm real-life:filesystem          # ~30s smoke (path traversal, injection, shell-in-args)
# or:
pnpm real-life:continuous          # corpus + adversarial fixtures (default 60 min)
```

Uses the official `@modelcontextprotocol/server-filesystem` upstream. Success targets: **≥95% attack block rate**, **≤2% benign false positives**. Details: [scenarios/real-life/README.md](scenarios/real-life/README.md).

```bash
# optional verification
curl -s 'http://localhost:4000/api/analytics/summary?window=1h' | jq '{totalRequests, errorRatePct}'
curl -s 'http://localhost:4000/api/security/dashboard?window=24h' | jq '{securityScore, activeThreatCount}'
```

### Key `pnpm` scripts (from repo root)

| Script | Purpose |
|--------|---------|
| `dashboard:proxy` | Proxy + dashboard at :4000 (recommended) |
| `autopilot:init` / `autopilot:start` | Wrap MCP configs and start Autopilot |
| `analyze` | Full security/health report to stdout |
| `real-life:filesystem` | Short live MCP attack smoke test |
| `real-life:continuous` | Extended corpus/adversarial attack stream |
| `real-life:swarm` | Live filesystem + security swarm analysis report |
| `security-swarm:analyze` | Unified swarm + live track → `reports/security-swarm/analysis.txt` |
| `harness` | Offline adversarial policy matrix (808+ fixtures) |

---

## The Policy File

Your rules live in `default-policy.yaml`. Here's a simple example:

```yaml
version: '1.0'
policy:
  mode: block           # block anything not explicitly allowed
  default_action: block

  rules:
    - name: allow-safe-tools
      description: Only allow read-only tools
      action: block
      tools:
        allow:
          - read_file
          - list_directory
          - search

    - name: block-shell-commands
      description: Never let the AI run shell commands
      action: block
      tools:
        deny:
          - bash
          - execute_command
          - eval

    - name: rate-limit
      description: Max 60 tool calls per minute
      action: block
      maxCallsPerMinute: 60
```

The default policy already blocks ~300 known attack patterns. You can extend it or write your own from scratch.

---

## Environment Variables

Common overrides:

| Variable | What it does |
|---|---|
| `MCP_GUARDIAN_POLICY` | Path to your policy YAML file |
| `MCP_GUARDIAN_DB_PATH` | SQLite call history (default `~/.mcp-guardian/history.db`; **share this** between `dashboard:proxy` and `real-life:*` runners) |
| `MCP_GUARDIAN_HOME` | Guardian home dir (semantic store, autopilot config) |
| `DASHBOARD_PORT` | Dashboard + API port (default `4000`) |
| `DASHBOARD_ENABLED` | Serve dashboard SPA + REST from proxy (default on with `dashboard:proxy`) |
| `GUARDIAN_WS_ENABLED` | Live WebSocket updates (default `true`) |
| `GUARDIAN_CI_BYPASS_LICENSE` | Local dev: enable dashboard REST without Pro license |
| `GUARDIAN_DAILY_BUDGET_USD` | Daily cost budget (alerts in Operations → Cost) |
| `GUARDIAN_LLM_PROVIDER` / `OLLAMA_BASE_URL` | Local Ollama for semantic audit, Threat Lab, full analysis |
| `REAL_LIFE_METRICS_ENABLED` | Set `false` when running a second proxy alongside `dashboard:proxy` |
| `LIVE_ATTACK_DURATION_MINUTES` | Wall-clock duration for `real-life:continuous` (default `60`) |
| `SOC_API_PORT` | Legacy standalone SOC API (default `4040`; see [SOC-API.md](SOC-API.md)) |

---

## What's in the box

| Component | What it is |
|---|---|
| `mcp-guardian proxy` | Main proxy — policy, audit, optional dashboard on `:4000` |
| `mcp-guardian onboard` | Finds and wraps MCP configs (Cline, Cursor, Claude Desktop, …) |
| `mcp-guardian autopilot` | Init/start/status for plug-and-play protection + dashboard |
| `mcp-guardian analyze` | Plain-English full security/health report (`pnpm analyze`) |
| `mcp-guardian tui` | Terminal UI for live traffic |
| `mcp-guardian doctor` | Health check for your setup |
| `pnpm dashboard:proxy` | Build + start proxy with dashboard SPA (recommended) |
| `deploy/dashboard-spa/` | Enterprise dashboard v3 (workspaces, analytics, security, setup) |
| `src/utils/dashboard-server.ts` | REST + static SPA + WebSocket (embedded in proxy) |
| `src/soc-api-server.ts` | Legacy standalone SOC API (`pnpm soc:api`) |
| `scenarios/real-life/` | Live filesystem MCP scenarios + continuous attack stream |
| `default-policy.yaml` | Default rules (~300 attack patterns) |
| `policy-templates/` | Ready-made policy templates |

---

## Dashboard API (embedded in proxy)

When `DASHBOARD_ENABLED=true`, the proxy serves the SPA and routes including:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/analytics/summary?window=1h\|12h\|24h\|7d` | Traffic KPIs, error rate, token/cost series |
| `GET /api/security/dashboard?window=24h` | Security score, active threats, threat table |
| `GET /api/aggregate/audit` | Block/pass audit with filters |
| `GET /api/autopilot/status` | Autopilot protection / learning / digest summary |
| `GET /api/setup/status` | Guided setup checklist |
| `WS /ws` | Live metric and audit ticks |

Legacy standalone backend: **[SOC-API.md](SOC-API.md)** (`pnpm soc:api:dev` on `:4040` + `pnpm dashboard:dev` on `:3000`).

---

## How the advanced features work (diagrams)

### The Security Swarm — continuous red-teaming

![Security Swarm architecture](docs/assets/security-swarm-architecture.png)

Think of the Security Swarm as a team of AI agents working around the clock to find weaknesses in your setup before attackers do.

There are two tracks running in parallel:

- **The testing track (top)** — Scout agents generate attack attempts, test them against your policy, check if any slip through, and write up a report. This runs automatically and keeps a library of 300+ known attacks up to date.
- **The learning track (bottom)** — Every time the live proxy blocks a real tool call, a learning agent looks at it, compares it to known patterns, and teaches the system to recognize similar attacks faster next time.

The two tracks feed each other: real-world blocks strengthen the test library, and new test discoveries improve live detection. It's a self-improving loop that never stops.

> **Pro feature** — requires a license key. Run with `pnpm security-swarm`.

---

### Threat Lab — AI discovers new attack patterns

![LLM Threat Discovery architecture](docs/assets/llm-threat-discovery-architecture.png)

The Threat Lab uses a local AI model (Ollama/Qwen) to invent new attack patterns that haven't been seen before.

Here's how it works step by step:

1. **Gather signals** — it looks at recent blocks from the proxy, semantic flags, CVE databases, and the swarm's bypass findings
2. **Generate attacks** — the LLM proposes new attack fixtures and potential YAML rule additions based on those signals
3. **Validate** — automated gates check if the proposals are valid and don't break anything
4. **Human review** — before anything is added to your policy, **you review and approve it**. Nothing applies automatically.

This means the system gets smarter over time, but you stay in control of every change.

> **Pro feature** — requires a license key + local Ollama with `qwen3:8b`. Run with `pnpm security-swarm:threat-lab`.

---

### Auto Threat Research — autonomous attack library building

![Self-Sustaining Threat Research architecture](docs/assets/auto-threat-research-architecture.png)

While the Threat Lab requires you to trigger it, Auto Threat Research runs in the background automatically whenever something interesting happens.

The flow:

1. **Watch for signals** — the proxy detects a semantic flag, a repeat block, or a CVE hit
2. **Queue it** — these signals are batched up (it waits a few seconds to group related events)
3. **Research it** — the LLM investigates: what attack class is this? What variations exist?
4. **Classify and write** — the finding is classified by type and written to the attack corpus

Importantly: **nothing is auto-applied to your policy**. This is an audit-only research loop. It just builds your library of known attacks for future reference and rule suggestions.

> **Pro feature** — runs automatically when `GUARDIAN_THREAT_RESEARCH_AUTO=true` is set.

---

## Pro license

Get a Pro license at **[mcp-guardian-cloud.vercel.app](https://mcp-guardian-cloud.vercel.app)** ($4.99 lifetime).

Community features (proxy, policy, scan, harness, real-life scenarios) are free and MIT licensed.

---

## Supported AI Clients

MCP Guardian auto-discovers config files from:

- **Cline** (VS Code extension)
- **Claude Desktop**
- **Cursor**
- **Windsurf**

Or point it at any MCP config file with `--config path/to/config.json`.

---

## License

MIT for all community features. See [LICENSE](LICENSE) and [COMMUNITY_SCOPE.md](COMMUNITY_SCOPE.md) for details.
Pro features are covered by [LICENSE-PRO](LICENSE-PRO).
