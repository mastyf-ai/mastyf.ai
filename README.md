<p align="center">
  <img src="docs/assets/logo.jpeg" alt="mastyf.ai logo" width="120" />
</p>

<h1 align="center">mastyf.ai</h1>

<p align="center"><strong>A safety layer between your AI assistant and the MCP tools it uses.</strong></p>

[![Website](https://img.shields.io/badge/Website-live-blue)](https://mastyf-ai-cloud-jet.vercel.app/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
[![CI](https://img.shields.io/badge/CI-GitHub_Actions-blue)](https://github.com/mastyf-ai/mastyf.ai/actions)

**Version 4.1.7** · [Website](https://mastyf-ai-cloud-jet.vercel.app/) · [Architecture](#architecture-diagrams) · [GitHub](https://github.com/mastyf-ai/mastyf.ai) · [Install from source](#getting-started--install-clone-and-run)

> **Live website:** [https://mastyf-ai-cloud-jet.vercel.app/](https://mastyf-ai-cloud-jet.vercel.app/) — trust scores, badges, and a free cloud console.  
> **Self-hosted proxy:** this repository (`@mastyf-ai/server`, CLI `mastyf-ai`) is **not published to npm yet** — clone and build from source below.

---

## Architecture diagrams

Visual overview of how mastyf.ai detects threats, learns from blocks, and improves policy over time. The same PNGs power the [live website architecture section](https://mastyf-ai-cloud-jet.vercel.app/#architecture) and live in [`docs/assets/`](docs/assets/).

| File | What it shows |
| ---- | ------------- |
| [`security-swarm-architecture.png`](docs/assets/security-swarm-architecture.png) | **Security Swarm** — CI red-team (Scout → Report) + runtime agents (BlockGuard → Calibrator) on every tool call |
| [`llm-threat-discovery-architecture.png`](docs/assets/llm-threat-discovery-architecture.png) | **Threat Lab** — local LLM proposes new attacks; you approve before policy changes |
| [`auto-threat-research-architecture.png`](docs/assets/auto-threat-research-architecture.png) | **Auto Threat Research** — live blocks feed new harness fixtures 24/7 (no silent policy apply) |
| [`logo.jpeg`](docs/assets/logo.jpeg) | mastyf.ai brand mark (same as `apps/cloud/public/logo.jpeg`) |

These are the **rebranded mastyf.ai** diagrams (replacing the former [MCP Guardian](https://github.com/rudraneel93/mcp-guardian/tree/master/docs/assets) assets).

### Security Swarm

![mastyf.ai Security Swarm architecture](docs/assets/security-swarm-architecture.png)

Two tracks work together: **CI** runs corpus regression, evasion probes, and Node/Python parity before merge; **runtime** applies policy on every `tools/call`, learns from blocks, and optionally runs semantic audit. [Full explanation →](#1-security-swarm--closed-loop-red-team)

### LLM Threat Discovery (Threat Lab)

![mastyf.ai LLM Threat Discovery architecture](docs/assets/llm-threat-discovery-architecture.png)

Local Ollama LLM turns real signals (bypasses, CVEs, corpus seeds) into validated test fixtures and optional rule ideas — **you review before anything is applied**. [Full explanation →](#3-llm-threat-discovery-threat-lab)

### Auto Threat Research

![mastyf.ai Auto Threat Research architecture](docs/assets/auto-threat-research-architecture.png)

Background loop: suspicious blocks are queued, researched, classified, and written as `adv-*.json` harness fixtures so CI catches similar attacks next time. [Full explanation →](#4-self-sustaining-threat-research-auto-threat-research)

### Three-layer detection (every tool call)

| Layer | What it catches |
| ----- | --------------- |
| **Regex triage** | Obvious injection, path traversal, secrets, Unicode tricks — microseconds, no LLM |
| **Schema analysis** | Oversized or malformed payloads before policy runs |
| **Semantic LLM audit** (optional) | Subtle abuse; rate-capped with Ollama fallback |

[Detailed architecture walkthrough →](#architecture-diagrams-explained)

---

### What's new in 4.1.7

- **Active Rules controls** — Security → Policy now includes list/search, soft disable/enable, and hard delete operations synced to YAML
- **Policy runtime semantics** — `enabled: false` is honored across rule strategies with backward-compatible defaults
- **Policy mutation APIs** — cloud + local dashboard endpoints for list/toggle/delete with updated README guidance

### What's new in 4.1.6

- **`mastyf-ai start`** — one command for proxy + web dashboard on port 4000 (local dev defaults)
- **`mastyf-ai setup`** — one-shot install for git clones (`pnpm install`, build, dashboard SPA)
- **npm tarball prep** — prebuilt dashboard UI (`deploy/dashboard-spa/out/`) built at pack time (publish pipeline not live yet)

### What's new in 4.1.0

**Industry roadmap plan compliance** — runtime verification and dashboard wiring for fleet-wide modules (A1–C5, B1–B3):

- **`mastyf-ai roadmap audit`** — CLI + `GET /api/agentic/plan-compliance/audit` verify shipped modules; exit 0 when production-ready
- **Dashboard Agentic AI panels** — plan compliance, reputation, zero-trust, federated learning, observatory mesh sync, sandbox wizard, chain graph (A1)
- **Protection home strip** — roadmap compliance score on the main Protection tab with link to Agentic AI
- **A1 ONNX graph path** — optional fleet chain classifier via `MASTYF_AI_FLEET_GRAPH_ONNX_MODEL`
- **B3 MPC-lite masking** — pairwise-masked federated gradients (`MASTYF_AI_FEDERATED_MPC`)
- **B2/B1 mesh relays** — observatory and reputation mesh publish/pull; dev stub via `MASTYF_AI_OBSERVATORY_STUB`
- **Cloud package scoring** — on-demand npm MCP trust scores, badge API, and `/certified` pages in `apps/cloud/`

Run `mastyf-ai roadmap audit --json` or open **Agentic AI → Overview** in the dashboard to confirm module compliance.

### What's new in 4.0.0

**Industry-standard MCP protection** — mastyf.ai moves from per-call filtering to fleet-wide, cross-agent security:

- **MTX v1** — open threat exchange format (`@mastyf-ai/mtx`) + cloud hub
- **Certified MCP** — HMAC attestation, persistent registry, verification API
- **Multi-step attack chains** — collusion detector + session-chain graph with proxy enforcement
- **Capability graph & intent binding** — tool/resource graph and session intent allowlists
- **Agent reputation ledger** — persistent scores with proxy enforcement
- **Dynamic sandbox tiers** — shadow / redact / allow with RL-ready persistence
- **Protocol fuzzer** — expanded corpus with real block validation and cert gates
- **Policy simulator** — `/api/policy/simulate` + `ab_test_policy` MCP tool
- **Incident playbooks & AI investigator** — webhook/isolate executors; Threat Lab–linked investigations
- **Compliance evidence runner** — live policy + audit wired to SOC2/HIPAA/PCI/FedRAMP/ISO mappings
- **mastyf-ai bench** — `mastyf-ai bench` CLI + public leaderboard at `/benchmarks`

**Roadmap (shipped in 4.0):** Semantic policy translator with approval flows, config provenance chain, STRIDE/LINDDUN threat modeling, behavioral biometrics, cross-MCP attack chains with SIEM export, digital twin sandbox, zero-trust SPIFFE scoring, decentralized reputation network, ecosystem observatory, insurance risk quantification + PDF export, and federated threat detection — see `src/agentic/industry-standard.ts` and module directories under `src/agentic/`.

### Fleet mandate for CISO buyers

mastyf.ai v4 is designed as a **fleet-wide control plane**, not a single-proxy filter:

- **Mandatory policy provenance** — every YAML change is hash-chained, signed, and exportable to SIEM/auditors
- **Human-in-the-loop policy approval** — NL drafts must pass simulation + explicit approval before apply
- **Cross-agent attack chain detection** — session graphs span servers; alerts export as CEF for Splunk/Datadog
- **SPIFFE/mTLS identity** — zero-trust composite scores include workload identity from SPIFFE SVIDs
- **Cloud observatory + reputation mesh** — anonymized fleet telemetry and server reputation consensus via the mastyf.ai cloud console
- **Insurance-ready risk reports** — ALE quantification with underwriter PDF export for cyber insurance workflows

---

## What problem does this solve?

Modern AI assistants (Claude, Cursor, Cline, and others) can connect to **tools** — read files, run commands, query databases, post to Slack, and more. Those connections often use a standard called **MCP** (Model Context Protocol).

That power is useful, but risky:

- The AI might read files it should not see.
- It might run shell commands or delete data by mistake or because of a malicious prompt.
- Secrets can leak through tool arguments.
- API costs can spike without you noticing.
- You may install an npm MCP package without knowing its CVE posture or supply-chain risk.

**mastyf.ai helps on both sides:**

1. **Before install** — look up any npm MCP package for a 0–100 trust score and embeddable badge at [mastyf-ai-cloud-jet.vercel.app/certified](https://mastyf-ai-cloud-jet.vercel.app/certified) (no account required).
2. **After deploy** — run the self-hosted proxy so every tool request is checked against your rules, blocked when risky, and logged — **before** anything reaches your real tools.

```
Your AI assistant
       │
       ▼
  mastyf-ai proxy  ← reads your rules, blocks bad calls, keeps a log
       │
       ▼
  Your real tools (files, GitHub, database, …)
```

---

## How it works (step by step)

1. **You clone and build mastyf.ai** and point it at your existing MCP setup (or run `mastyf-ai onboard` to do this automatically).
2. **mastyf.ai wraps your tool servers** so the AI talks to mastyf.ai instead of talking to them directly.
3. When the AI tries to use a tool, mastyf.ai receives the request first.
4. mastyf.ai compares the request to your **policy** (a simple rules file you control).
5. If the request is allowed, mastyf.ai forwards it to the real tool and returns the result.
6. If the request breaks a rule, mastyf.ai **blocks it** and tells the AI it was denied — the real tool never runs.
7. Every allow and block is saved to a local database so you can review history and see charts on the dashboard.

You stay in control: mastyf.ai does not silently change your rules unless you approve it (for example when reviewing Threat Lab suggestions).

---

## Architecture

This section shows how mastyf.ai is wired together: what runs where, how a tool call flows through governance, and how Security Swarm / Threat Lab pipelines connect to the proxy.

**In this section:** System overview · Tool call path · Transports · Agentic AI · Dashboard · [Architecture diagrams (explained)](#architecture-diagrams-explained) · Cloud app

### System overview

When you run **`mastyf-ai start`** or `pnpm dashboard:proxy`, one Node process typically hosts the **policy proxy**, the **dashboard API**, and (optionally) **agentic services**. All components share the same audit database (`MASTYF_AI_DB_PATH`, default `~/.mastyf-ai/history.db`).

```
AI clients (Cursor / Cline / Claude)
       │
       ▼
┌──────────────────────────────────────────┐
│  mastyf.ai process                       │
│  Proxy (stdio/HTTP/SSE/WS/streamable)    │
│  PolicyEngine (YAML + hot reload)        │
│  Agentic container (optional hooks)      │
│  Dashboard REST + WebSocket              │
└──────────────┬───────────────────────────┘
               │
       ┌───────┴────────┐
       ▼                ▼
  history.db      SIEM exporters (optional)
       │
       ▼
  Upstream MCP servers (filesystem, GitHub, …)
```

| Component | Role | Main code |
| --------- | ---- | --------- |
| **Proxy layer** | Intercepts JSON-RPC; enforces policy on every `tools/call` | [`src/proxy/`](src/proxy/) |
| **Policy engine** | Evaluates YAML rules, rate limits, RBAC, patterns | [`src/policy/`](src/policy/) |
| **History DB** | Stores allow/block audit, tokens, cost | [`src/database/history-db.ts`](src/database/history-db.ts) |
| **Dashboard** | Local UI + REST API over the same DB | [`deploy/dashboard-spa/`](deploy/dashboard-spa/), [`src/utils/dashboard-server.ts`](src/utils/dashboard-server.ts) |
| **Agentic** | Smart features (injection scan, policy gen, trust, mesh, etc.) | [`src/agentic/`](src/agentic/) |
| **Cloud app** | Public scores, badges, org console (not on npm) | [`apps/cloud/`](apps/cloud/) |

Enterprise deployments may add **Redis** (rate limits, DPoP, circuit-breaker sync) and **PostgreSQL** instead of SQLite — see [`deploy/helm/`](deploy/helm/) and [`packages/PACKAGING.md`](packages/PACKAGING.md).

### Tool call path (`tools/call`)

Every dangerous decision happens **before** the real MCP server runs. If mastyf.ai blocks a call, the upstream tool never receives it.

```
AI client → pre-forward guard → policy engine → semantic gate → audit → upstream MCP
                ↓ blocked anywhere = upstream never called
```

**Integration details:**

1. **Pre-forward guard** ([`src/proxy/tool-call-pre-guard.ts`](src/proxy/tool-call-pre-guard.ts)) — caps expanded argument size and runs agentic pre-hooks (prompt injection, etc.) on all transports.
2. **Policy** ([`src/policy/policy-engine.ts`](src/policy/policy-engine.ts)) — your YAML rules; rate-limit counters survive hot-reload via [`src/policy/rate-limit-store.ts`](src/policy/rate-limit-store.ts).
3. **Semantic gate** ([`src/proxy/proxy-post-policy-gates.ts`](src/proxy/proxy-post-policy-gates.ts)) — optional LLM/heuristic check on arguments before forward.
4. **Audit** — `persistCallRecord` → async audit-write-queue → SQLite; blocks also emit structured SIEM events when enabled.

### Transports

mastyf.ai implements the same governance stack on every MCP transport your IDE might use:

| Transport | Entry module | `tools/call` governance |
| --------- | ------------ | ----------------------- |
| **stdio** | [`src/proxy/proxy-server.ts`](src/proxy/proxy-server.ts) | Full pipeline (default for wrapped configs) |
| **HTTP** | [`src/proxy/http-proxy-server.ts`](src/proxy/http-proxy-server.ts) | Full + pre-forward guard |
| **SSE** | [`src/proxy/sse-proxy-server.ts`](src/proxy/sse-proxy-server.ts) | Full + pre-forward guard |
| **WebSocket** | [`src/proxy/websocket-proxy-server.ts`](src/proxy/websocket-proxy-server.ts) | Full + pre-forward guard |
| **Streamable HTTP** | [`src/proxy/streamable-http-proxy-server.ts`](src/proxy/streamable-http-proxy-server.ts) | Full + pre-forward guard |

Run `mastyf-ai onboard` so client configs point at mastyf.ai-wrapped servers. If an IDE connects to an MCP server **around** the proxy (common with raw SSE URLs), calls are **untracked** — metrics and logs will show `sse_untracked`.

### Agentic AI integration

Agentic features are optional modules loaded at boot ([`src/container.ts`](src/container.ts)). They do not replace your YAML policy; they add observation, scoring, and recommendations.

| Integration point | What happens |
| ----------------- | ------------ |
| **Every `tools/call`** | [`runAgenticPreForwardHooks`](src/agentic/proxy-integration.ts) can block or sanitize arguments when agentic mode is on |
| **MCP tools** | ~70+ agentic tools registered in [`src/index.ts`](src/index.ts) for automation and dashboard actions |
| **Modules** | 40+ agentic modules in [`src/agentic/`](src/agentic/) (prediction, policy-gen, mesh, collusion, reputation, drift, compliance, etc.) |
| **Dashboard** | **Agentic AI** workspace reads [`/api/agentic/*`](src/utils/agentic-dashboard-summary.ts) summaries |
| **Database** | Agentic state in [`011-agentic-tables.sql`](src/database/migrations/011-agentic-tables.sql) |

Module directories (each implements a shipped capability): `threat-prediction`, `policy-gen`, `prompt-injection`, `threat-mesh`, `honeypot`, `supply-chain`, `compliance`, `drift`, `red-team`, `protocol-fuzzer`, `trust-negotiation`, `trust-score`, `collusion-detector`, `capability-graph`, `intent-binding`, `agent-reputation`, `sandbox-tier`, `certification`, `incident-playbook`, `response-dlp`, `rl`, `mcp-lifecycle`, `cross-chain`, `digital-twin`, `biometrics`, `provenance`, `threat-modeling`, `zero-trust`, `observatory`, `federated`, `reputation`, `insurance`, `semantic-policy`, and related helpers in `core.ts` / `scheduler.ts`.

### Dashboard and observability

```
Proxy writes → history.db → Dashboard REST API → Next.js SPA (Protection, Activity, Agentic)
                          → WebSocket push (MASTYF_AI_WS_ENABLED)
                          → Prometheus metrics (optional)
                          → SIEM exporters (MASTYF_AI_SIEM_ENABLED)
```

The dashboard is not a separate database — it reads the same `call_records` the proxy writes. Set `MASTYF_AI_DB_PATH` consistently when running `pnpm real-life:filesystem` or other tests so charts match proxy traffic.

### Architecture diagrams (explained)

These diagrams also appear on the [live website](https://mastyf-ai-cloud-jet.vercel.app/#architecture). Source files live in [`docs/assets/`](docs/assets/) (copied from the rebranded mastyf.ai cloud app).

---

#### 1. Security Swarm — closed-loop red team

![mastyf.ai Security Swarm architecture](docs/assets/security-swarm-architecture.png)

*mastyf.ai Security Swarm — CI regression, evasion probes, Node/Python parity, and runtime learning on the hot path.*

**What this diagram shows, in plain language:**

Security Swarm is mastyf.ai’s automated red team. It keeps testing your policy the way an attacker would — in CI before you merge, and at runtime while the proxy is live — so weak rules are found before production traffic hits them.

The diagram has **two tracks** that work together:

| Track | Agents (in the diagram) | What they do |
| ----- | ----------------------- | ------------ |
| **CI track** (offline, before merge) | **Scout** | Scans dependencies and config for CVEs, risky tools, and policy gaps. |
| | **Corpus** | Replays the policy evaluation corpus (~300 JSON attack/benign entries) and fails if an attack slips through or a safe call is blocked. |
| | **Evasion** | Runs obfuscation probes — tricks like Unicode hiding and encoding — to see if regex rules can be fooled. |
| | **Parity** | Compares the TypeScript and Python policy engines on ~813 harness fixtures so both implementations agree. |
| | **Report** | Writes `reports/security-swarm/latest.json`, plain-English analysis, and dashboard figures. |
| **Runtime track** (live, on every tool call) | **BlockGuard** | Applies your YAML policy on every `tools/call` before the real MCP server runs. |
| | **InstantLearner** | Watches block patterns and suggests new rules from rolling stats — suggestions only, not auto-applied. |
| | **SemanticAuditor** | Optional tier-2 LLM review on suspicious arguments (rate-capped, with local Ollama fallback). |
| | **Calibrator** | Tunes semantic thresholds from labeled outcomes in the dashboard. |

**How the pieces connect:** CI agents feed the adversarial harness and corpus under `adversarial-harness/` and `corpus/`. Runtime agents read and write the same `history.db` audit log the dashboard uses. When CI finds a bypass, Threat Lab can propose a fix; when runtime blocks something new, Auto Threat Research can add it to the fixture library — always with human review before policy changes.

**Run it:**

```bash
pnpm security-swarm:fast      # PR gate (~5–15 min)
pnpm security-swarm:analyze   # full analysis + live MCP scenarios
```

More detail: [`security-swarm/README.md`](security-swarm/README.md).

---

#### 2. Three-layer detection (every `tools/call`)

Before Threat Lab or Swarm even run, every tool call passes through three fast checks:

| Layer | What it catches | Why it exists |
| ----- | --------------- | ------------- |
| **1. Regex triage** | Obvious injection, path traversal, secret exfiltration, Unicode confusables | Blocks the majority of attacks in microseconds — no LLM needed. |
| **2. Schema analysis** | Oversized payloads, malformed JSON, excessive nesting | Stops crash and DoS-style abuse before policy rules run. |
| **3. Semantic LLM audit** (optional) | Subtle prompt injection and context-dependent abuse | Catches attacks that look innocent to regex; rate-capped with Ollama/local fallback. |

If any layer blocks, the upstream MCP server never receives the call.

---

#### 3. LLM Threat Discovery (Threat Lab)

![mastyf.ai LLM Threat Discovery architecture](docs/assets/llm-threat-discovery-architecture.png)

*Human-in-the-loop discovery — the LLM proposes new attacks and rules; you approve before anything changes.*

**What this diagram shows, in plain language:**

Threat Lab uses a **local LLM** (Ollama) to suggest new test cases when mastyf.ai sees interesting security signals. Nothing is applied automatically — you always review first.

| Step | Label in diagram | What happens |
| ---- | ---------------- | ------------ |
| 1 | **Inputs** | Real signals only: swarm bypasses, semantic true-positives, ThreatIntel CVE hits, and corpus attack seeds. |
| 2 | **Discover** | Ollama proposes an attack class, a test hypothesis, a new corpus fixture, and sometimes a YAML rule line. |
| 3 | **Validate** | Automated gates: JSON schema check, dangerous-regex rejection, replay block test, fingerprint dedupe. |
| 4 | **Manifest** | Valid proposals land in `threat-lab-candidates.json` with provenance — ready for dashboard review. |
| 5 | **Review** | You accept or reject in the dashboard. Accept can apply a policy rule; reject discards. Fixtures always go to the harness for future regression either way. |

**Run:**

```bash
pnpm security-swarm:threat-lab
# Requires Ollama at http://127.0.0.1:11434
```

---

#### 4. Self-Sustaining Threat Research (Auto Threat Research)

![mastyf.ai Auto Threat Research architecture](docs/assets/auto-threat-research-architecture.png)

*Continuous research loop — live proxy blocks feed new adversarial fixtures around the clock.*

**What this diagram shows, in plain language:**

Auto Threat Research runs in the background while your proxy is live. When something suspicious is blocked, it queues the event, researches it with the same LLM path as Threat Lab, and — if validation passes — writes a new `adv-*.json` fixture to `adversarial-harness/fixtures/`. **It does not change live policy by itself** — it grows the test library so CI and Swarm catch similar attacks next time.

| Step | Label in diagram | What happens |
| ---- | ---------------- | ------------ |
| 1 | **Detect** | Semantic flags, repeat blocks, ThreatIntel alerts, swarm bypasses, and corpus seeds enqueue events. |
| 2 | **Queue** | Events are debounced and rate-capped (duplicate fingerprints skipped). |
| 3 | **Research** | Same Threat Lab LLM path with a minimum confidence gate (default 0.85). |
| 4 | **Classify** | Discoveries are mapped to corpus categories before write. |
| 5 | **Write** | Validated `adv-*.json` files are added to the harness — audit trail only, no silent policy apply. |

**Enable:**

```bash
export MASTYF_AI_THREAT_RESEARCH_AUTO=true
export SWARM_THREAT_RESEARCH_AUTO=true
pnpm security-swarm:auto-threat-research
```

---

### Continuous improvement loop

```
Live proxy blocks → history.db → Security Swarm + Threat Lab + Auto Threat Research
                                      ↓
                         new fixtures & policy ideas (human review)
                                      ↓
                         adversarial harness + corpus → stronger default policy
```

All three diagrams above are the same assets used on [mastyf-ai-cloud-jet.vercel.app](https://mastyf-ai-cloud-jet.vercel.app/#architecture).

### Cloud app (`apps/cloud`)

The Next.js app powers the live website at [mastyf-ai-cloud-jet.vercel.app](https://mastyf-ai-cloud-jet.vercel.app/). It is **not** published to npm.

| Route / API | What it does |
| ----------- | ------------ |
| `/certified` | Look up npm MCP packages; 0–100 trust score and grade |
| `/api/v1/badge/<package>` | SVG or JSON trust badge for README embeds |
| `/api/v1/deep-scan/<package>` | Optional live MCP probe (stdio via `npx`) |
| `/dashboard` | Free org console — policy YAML, API keys, fleet |
| `/observatory` | Anonymized fleet telemetry snapshot |
| `/benchmarks` | Community proxy profile leaderboard |

Cloud deploy: [`apps/cloud/docs/VERCEL_DEPLOY.md`](apps/cloud/docs/VERCEL_DEPLOY.md) · Custom domain: [`apps/cloud/docs/CUSTOM_DOMAIN.md`](apps/cloud/docs/CUSTOM_DOMAIN.md)

---

## Features explained

Below is what each major capability does, in plain language.

### mastyf.ai website — security scores & badges

**What it is:** A public lookup for npm MCP package trust — no install required.

**How it works:** Enter a package name at [`/certified`](https://mastyf-ai-cloud-jet.vercel.app/certified). Static analysis runs on npm metadata, CVE feeds, and registry signals. You get a 0–100 score, letter grade, category breakdown, and copy-paste badge markdown. Optional deep scan connects to the package over stdio when enabled.

**Why it matters:** Teams can check supply-chain posture before agents touch production data.

```bash
curl -s "https://mastyf-ai-cloud-jet.vercel.app/api/v1/badge/@playwright%2Fmcp/json"
```

---

### mastyf.ai cloud console

**What it is:** A free signed-in console for policy and fleet management — hosted, no self-hosted proxy required.

**How it works:** Sign in with Google or GitHub at [`/dashboard`](https://mastyf-ai-cloud-jet.vercel.app/dashboard). Edit policy YAML in the browser, publish changes, rotate API keys, and view self-hosted proxy heartbeats when linked.

**Why it matters:** Policy and tenant management without running the full proxy stack locally.

---

### Policy proxy (the core)

**What it is:** A filter on every tool call.

**How it works:** You write rules in a YAML file (see [The policy file](#the-policy-file) below). Rules can allow specific tools, deny dangerous ones, limit how often tools run, cap token usage, and match patterns in arguments (for example “block if the path contains `../`”). When you change the file, mastyf.ai can reload rules without restarting.

**Why it matters:** This is your main line of defense — fast, predictable, and fully under your control.

---

### Attack blocking (built into the default policy)

**What it is:** Hundreds of pre-written checks for common abuse.

**How it works:** Before a call reaches your server, mastyf.ai looks for things like shell commands hidden in arguments, path traversal (`../etc/passwd`), SQL injection patterns, attempts to exfiltrate secrets, suspicious URLs, and Unicode tricks that hide malicious text. If a pattern matches, the call is blocked and logged.

**Why it matters:** Many real-world attacks look like normal tool calls; these checks catch a large class of them without an AI model.

---

### Cost tracking

**What it is:** A running tally of how much your tool usage costs.

**How it works:** mastyf.ai estimates tokens and dollar cost per call (using model pricing when available). You can set budgets and see burn rate over time in the dashboard.

**Why it matters:** Runaway agents or loops can get expensive; you see it early.

---

### Health monitoring

**What it is:** A health check for each connected MCP server.

**How it works:** mastyf.ai tracks success rate, latency, and whether a server is responding. If a server keeps failing, a circuit breaker can stop hammering it.

**Why it matters:** You notice broken or flaky integrations before users complain.

---

### Live audit log

**What it is:** A permanent record of what was allowed and what was blocked.

**How it works:** Each decision is stored in a local SQLite database (default: `~/.mastyf-ai/history.db`). The dashboard reads this database to show tables, charts, and filters.

**Why it matters:** Security and debugging need a clear trail — who tried what, when, and why it was blocked.

---

### Package scanning (CVE and typo-squat)

**What it is:** A check on MCP packages before you trust them.

**How it works:** mastyf.ai can scan installed or configured packages for known security issues (CVEs) and names that look like famous packages but are slightly misspelled (typo-squatting). CLI: `mastyf-ai scan --all`.

**Why it matters:** Supply-chain attacks often arrive as “almost the right” package name.

---

### Adversarial harness (offline tests)

**What it is:** A large automated test suite that fires attack-like requests at your policy **without** a live AI.

**How it works:** Run `pnpm harness` from the repo. It replays **~835 fixtures** and reports what would be blocked or allowed. Node/Python parity compares **~813** fixtures via `pnpm harness:parity`.

**Why it matters:** You can change rules and immediately see if you broke legitimate use or left a hole open.

---

### Real-life scenarios (live tests)

**What it is:** A short or long run of real attack traffic against a real filesystem MCP server through mastyf.ai.

**How it works:** Commands like `pnpm real-life:filesystem` drive the official filesystem server with path traversal, injection, and similar tests while the proxy is running. Results show up in the dashboard if you use the same database path.

**Why it matters:** Offline tests are fast; live tests prove the full path (proxy → policy → log → UI) works.

---

## Agentic AI features (version 4.1)

These are **smart assistants inside mastyf.ai** that watch, score, and recommend — they do not replace your policy unless you choose to apply a suggestion.

### Shipped today

| Feature | What it does for you |
| ------- | -------------------- |
| **Threat prediction** | Scores how risky each MCP server is and suggests hardening before something breaks. |
| **Policy generation** | Watches normal tool use, then drafts a tight “only what you actually need” policy you can review. |
| **Prompt injection detection** | Scans tool arguments for text meant to hijack another AI (heuristic + optional LLM). |
| **Threat mesh (MTX)** | Opt-in anonymized attack-pattern sharing; `@mastyf-ai/mtx` open exchange format. |
| **Honeypots** | Deploys fake decoy servers; probes trigger alerts. |
| **Supply chain checks** | Publisher verification, dependency confusion, typo-squat detection, SBOM export. |
| **Compliance mapping** | Maps posture to SOC 2, HIPAA, PCI-DSS, FedRAMP, ISO 27001 with evidence runner. |
| **Drift detection** | Notices when a server’s tools or behavior change unexpectedly. |
| **Red team & protocol fuzzer** | Curated and mutated attacks; expanded fuzz corpus with cert gates. |
| **Trust protocol & trust score** | Agent-to-agent negotiation plus local trust scoring. |
| **Collusion & attack chains** | Multi-step pattern detection across agents/tools (session-chain graph). |
| **Capability graph & intent binding** | Maps tool/resource relationships; session intent allowlists. |
| **Agent reputation** | Persistent reputation ledger with proxy enforcement. |
| **Sandbox tiers** | Dynamic shadow / redact / allow per tool or server. |
| **Certified MCP** | HMAC-signed server attestation and verification tiers. |
| **Policy simulator** | Preview policy impact before deploy (`ab_test_policy`, REST simulate API). |
| **Incident playbooks & investigator** | Automated playbook steps; AI incident investigation in the dashboard. |
| **MCP lifecycle guard** | Session-gated access to `tools/list`, `resources/read`, `prompts/get`. |
| **Response DLP** | Scans upstream tool responses and streaming output for secrets. |
| **RL tuning** | Contextual bandits and Thompson sampling for threshold optimization. |

**Dashboard:** Open **Agentic AI** in the web UI for overview charts, trust scores, audit tables, and admin tools.

### Industry-standard roadmap (shipped in 4.0)

mastyf.ai’s industry-standard layer delivers **cross-server, cross-agent, systemic** protection. All eleven capabilities shipped in v4.0:

| Tier | Features | Theme |
| ---- | -------- | ----- |
| **1 — Paradigm** | A1 Cross-MCP attack chain detection · A2 Digital twin & policy sandbox · A3 Agent behavioral biometrics | See the forest, not just the trees |
| **2 — Ecosystem** | B1 Decentralized reputation network · B2 Ecosystem health observatory · B3 Federated threat detection | Network effects across deployments |
| **3 — Enterprise** | C1 Config provenance chain · C2 Threat modeling as code (STRIDE/LINDDUN) · C3 Zero-trust continuous verification · C4 Insurance risk quantification · C5 Semantic policy translator | Compliance, CFO, and business stakeholders |

**Verify compliance:** Run `mastyf-ai roadmap audit` (or `--json` for machine-readable output). The dashboard **Agentic AI → Overview** tab shows the same runtime audit via **Industry Roadmap Compliance**. Additional CLI utilities: `mastyf-ai roadmap fleet-graph-train`, `federated-export|import`, `observatory-sync`, `reputation-sync`.

**Production env vars** (optional): fleet chain blocking (`MASTYF_AI_FLEET_CHAIN_BLOCK_CONFIDENCE`), multi-region Redis (`MASTYF_AI_FLEET_REGION`), observatory relay or dev stub (`MASTYF_AI_OBSERVATORY_RELAY_URL`, `MASTYF_AI_OBSERVATORY_STUB`), federated learning (`MASTYF_AI_FEDERATED_LEARNING`, `MASTYF_AI_FEDERATED_MPC`), ONNX graph model (`MASTYF_AI_FLEET_GRAPH_ONNX_MODEL`). Full list in [`.env.example`](.env.example).

---

## The web dashboard

**What it is:** A local website (default [http://localhost:4000](http://localhost:4000)) that shows what mastyf.ai is doing.

**How it works:** When you run **`mastyf-ai start`** (or `pnpm dashboard:proxy` from a git clone), the same process serves the dashboard and the API. The UI reads real data from your history database — not fake demo numbers.

**Main areas:**

| Area | What you see |
| ---- | ------------ |
| **Protection** | Overall status and plain-English analysis of your setup. |
| **Activity** | Audit log of allowed and blocked calls. |
| **Threats** | Active threats and quarantine actions. |
| **Security** | Security score and trends. |
| **Operations** | Traffic, errors, and cost charts over time. |
| **Agentic AI** | Autonomous features: trust, threats, policy, operations, audit, and tools. Industry roadmap panels (A1–C5, B1–B3) live here — plan compliance audit on **Overview**. |
| **Settings** | Servers, policy, and setup checklist. |

In **Security → Policy**, you can manage rules without hand-editing YAML:

- **Active Rules list** with search/filter
- **Soft disable/enable** (writes `enabled: false/true` on the rule)
- **Hard delete** (removes the rule from `policy.rules[]`)
- Editor stays in sync with structured actions so YAML remains source-of-truth

**Tip:** If charts say “no traffic in this time window,” widen the **Time window** dropdown (for example **Last 7 days**). Short windows only show very recent calls.

---

## Security Swarm

**What it is:** A team of automated testers that keep trying to break your policy the way an attacker would.

![Security Swarm architecture](docs/assets/security-swarm-architecture.png)

**How it works:**

- **CI track** (Scout, Corpus, Evasion, Parity, Report) — runs offline before merge: corpus regression, obfuscation probes, and Node/Python parity on ~813 fixtures.
- **Runtime track** (BlockGuard, InstantLearner, SemanticAuditor, Calibrator) — runs on the live proxy: policy blocks, pattern learning, optional semantic audit, threshold tuning.
- The two tracks feed each other so tests get better as your deployment sees real traffic.

**Why it matters:** Your policy is only as strong as the attacks you have tested against; the swarm expands that set continuously.

**Run:**

```bash
pnpm security-swarm:fast      # PR gate (~5–15 min)
pnpm security-swarm:analyze   # full analysis + live MCP scenarios
```

Full walkthrough of the diagram: [Architecture § Security Swarm](#1-security-swarm--closed-loop-red-team) · Artifacts: [`security-swarm/README.md`](security-swarm/README.md)

---

## Threat Lab

**What it is:** Uses a local AI model to **propose** new attack patterns and rule ideas based on what mastyf.ai has seen.

![LLM Threat Discovery architecture](docs/assets/llm-threat-discovery-architecture.png)

**How it works:**

1. **Inputs** — swarm bypasses, semantic true-positives, ThreatIntel CVEs, corpus attacks (real signals only).
2. **Discover** — local Ollama LLM proposes attack class, hypothesis, fixture, and optional YAML rule.
3. **Validate** — schema, dangerous-regex, replay block test, fingerprint dedupe.
4. **Manifest** — signed `threat-lab-candidates.json` for dashboard review.
5. **Review** — you accept or reject; nothing is applied automatically.

Full walkthrough: [Architecture § LLM Threat Discovery](#3-llm-threat-discovery-threat-lab)

**Run:**

```bash
pnpm security-swarm:threat-lab
# Requires Ollama at http://127.0.0.1:11434
```

---

## Auto Threat Research

**What it is:** Background research when something interesting is blocked.

![Auto Threat Research architecture](docs/assets/auto-threat-research-architecture.png)

**How it works:** When the proxy blocks a suspicious call, events are debounced, researched by the same LLM path as Threat Lab, classified, and — if validation passes — written as `adv-*.json` harness fixtures. **It does not change your live policy by itself** — it builds the test library for CI and Swarm.

Full walkthrough: [Architecture § Auto Threat Research](#4-self-sustaining-threat-research-auto-threat-research)

**Enable:**

```bash
export MASTYF_AI_THREAT_RESEARCH_AUTO=true
export SWARM_THREAT_RESEARCH_AUTO=true
pnpm security-swarm:auto-threat-research
```

---

## mastyf.ai Autopilot

**What it is:** One-command setup: wrap MCP configs, start the proxy, turn on the dashboard, and optional background services (digests, learning).

**How it works:**

```bash
pnpm autopilot:init -- --apply
pnpm autopilot:start
pnpm autopilot:status
```

Or via CLI: `mastyf-ai autopilot init` / `mastyf-ai autopilot start`.

---

## Open source vs optional license enforcement

This repository is **MIT licensed**. All proxy, policy, dashboard, swarm, and agentic code ships in the repo.

| Capability | Default (MIT) | With `MASTYF_AI_REQUIRE_LICENSE=true` |
| ---------- | ------------- | ------------------------------------- |
| Policy proxy and YAML rules | Yes | Yes |
| Attack blocking, audit log, cost tracking | Yes | Yes |
| Harness and real-life scenarios | Yes | Yes |
| Full dashboard + Security Swarm | Yes | Yes (requires valid cloud API key) |
| Fleet, SSO, Kubernetes, PostgreSQL | Yes (self-hosted) | Yes |

By default, feature gating is **off** — everything in the repo runs without a license key. Set `MASTYF_AI_REQUIRE_LICENSE=true` plus `MASTYF_AI_LICENSE_KEY` and `MASTYF_AI_CONTROL_PLANE_URL` only when you want cloud-enforced licensing in production.

Local development: `MASTYF_AI_CI_BYPASS_LICENSE=true` with `pnpm dashboard:proxy` or `mastyf-ai start`.

---

## Getting started — install, clone, and run

This section walks through every path to a working mastyf.ai: **git clone** (current recommended path), and **`mastyf-ai start`** (or `pnpm dashboard:proxy` from the repo) to run the **proxy + web dashboard** together on port **4000**.

> **npm note:** The package name `@mastyf-ai/server` and CLI `mastyf-ai` are defined in this repo but **not yet published to npm**. Install from source below. When npm publish is live, `npm install -g @mastyf-ai/server` will be the recommended user path.

### What you need

| Requirement | Notes |
| ----------- | ----- |
| **Node.js 18+** | Required |
| **pnpm** | Required for the monorepo (`pnpm install`, `pnpm build`) |
| **Git** | Clone-from-source workflow |
| **Postgres** | Cloud console local dev only (`DATABASE_URL` in `apps/cloud/.env.local`) |
| **Ollama** (optional) | Local LLM at http://127.0.0.1:11434 for semantic detection, Threat Lab, and Auto Threat Research |

---

### Clone and set up (recommended today)

```bash
git clone https://github.com/mastyf-ai/mastyf.ai.git
cd mastyf.ai

# Install workspace dependencies (pnpm is required for the monorepo)
corepack enable
pnpm install

# Copy optional environment overrides
cp .env.example .env
# Edit .env if you need NVD keys, LLM URLs, custom DB path, etc.

# Compile TypeScript + workspace packages + dashboard SPA (first time)
pnpm build
pnpm setup
# setup = pnpm install (if needed) + build + scripts/build-dashboard-spa.sh
```

**One-liner after clone:**

```bash
git clone https://github.com/mastyf-ai/mastyf.ai.git && cd mastyf.ai && pnpm install && pnpm build && pnpm setup
```

**Run from the repo without a global install:**

```bash
node dist/cli.js start
# or: pnpm dashboard:proxy
```

Verify install health:

```bash
node dist/cli.js --version
node dist/cli.js doctor
```

---

### Configure environment

mastyf.ai reads environment variables at startup. For local development, defaults in `scripts/start-dashboard-proxy.sh` are usually enough.

```bash
cp .env.example .env
```

| Variable | Purpose | Default (dev) |
| -------- | ------- | ------------- |
| `MASTYF_AI_DB_PATH` | SQLite audit/history DB | `~/.mastyf-ai/history.db` |
| `DASHBOARD_ENABLED` | REST API + web UI | `true` when using `mastyf-ai start` or `dashboard:proxy` |
| `DASHBOARD_PORT` | Dashboard URL port | `4000` |
| `DASHBOARD_AUTH_DISABLED` | Skip login on localhost | `true` in dev script |
| `MASTYF_AI_CI_BYPASS_LICENSE` | Local dev license bypass | `true` in dev script |
| `MASTYF_AI_LLM_ENABLED` | Semantic / AI features | `true` in dev script |
| `OLLAMA_BASE_URL` | Local LLM endpoint | `http://127.0.0.1:11434` |
| `MASTYF_AI_WS_ENABLED` | Live WebSocket metrics | `true` |
| `MASTYF_AI_CONTROL_PLANE_URL` | Cloud console URL for policy sync | `https://mastyf-ai-cloud-jet.vercel.app` |

Example — use a repo-local database so tests and dashboard share the same file:

```bash
export MASTYF_AI_DB_PATH="$PWD/reports/local-history.db"
mkdir -p "$(dirname "$MASTYF_AI_DB_PATH")"
```

Full reference: [`.env.example`](.env.example).

---

### Start the dashboard and proxy (recommended)

**Primary command (after build):**

```bash
mastyf-ai start
# or from repo without global link:
node dist/cli.js start
```

Sets local defaults (`DASHBOARD_ENABLED`, `MASTYF_AI_DB_PATH=~/.mastyf-ai/history.db`, license bypass for localhost), picks a single-server `mastyf-ai-configs/*.json` (or onboard `configsDir`), and runs proxy + API + UI.

**Custom config or policy:**

```bash
mastyf-ai start --config mastyf-ai-configs/filesystem.json --policy default-policy.yaml
mastyf-ai start --build-dashboard   # git clone: build SPA if out/ missing
```

**From the repo (dev script, same stack + extra dev env):**

```bash
pnpm dashboard:proxy
# or: pnpm dashboard:proxy -- mastyf-ai-configs/filesystem.json default-policy.yaml
```

**What this does:**

1. Rebuilds `dist/` if dashboard-related sources changed (dev script only)
2. Builds the dashboard SPA (`deploy/dashboard-spa/out/`) if missing
3. Picks a single-server MCP config unless you pass `--config`
4. Starts **one Node process** that runs:
   - the **MCP proxy** (stdio to your upstream MCP server),
   - the **dashboard REST API**,
   - the **static web UI** at [http://localhost:4000/](http://localhost:4000/),
   - optional **agentic** schedulers and WebSocket push.

**Expected console output:**

```
[dashboard-proxy] DB: /Users/you/.mastyf-ai/history.db
[dashboard-proxy] Dashboard: http://localhost:4000/
[dashboard-proxy] Config: mastyf-ai-configs/filesystem.json  Policy: default-policy.yaml  Mode: block
```

Open the browser → **Protection**, **Activity**, **Agentic AI**, etc. If charts are empty, widen the time window (e.g. **Last 7 days**) or generate traffic (next section).

**Stop:** `Ctrl+C` in the terminal. If port 4000 is stuck: `lsof -ti :4000 | xargs kill`.

---

### Dashboard UI development (hot reload)

When editing React panels under `deploy/dashboard-spa/`, run the SPA dev server separately:

```bash
# Terminal 1 — proxy + API (backend)
pnpm dashboard:proxy

# Terminal 2 — Next.js dev server for the SPA (frontend hot reload)
pnpm dashboard:dev
```

---

### Easiest path: onboard (wrap your AI client)

After **build**, let mastyf.ai find and wrap MCP configs for Cursor, Claude Desktop, Cline, and Windsurf:

```bash
mastyf-ai onboard --apply
mastyf-ai start
```

`--apply` patches your live IDE MCP JSON (with backup). Restart your AI client so traffic flows through mastyf.ai.

**If you see “No MCP config found for client auto”:**

- Install and configure an IDE with MCP first (Cursor, Cline, Claude Desktop, or Windsurf), **or**
- Pass a client: `mastyf-ai onboard --client cursor --apply`, **or**
- Pass a config file: `mastyf-ai onboard --config /path/to/mcp.json --apply`, **or**
- Skip onboard and start with a repo example: `mastyf-ai start --config mastyf-ai-configs/filesystem.json`

**Common config paths (macOS):**

| Client | Config file |
| ------ | ----------- |
| Cline | `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |
| Cursor | `~/.cursor/mcp.json` |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |

From a **git clone** (before/after build):

```bash
pnpm build
pnpm onboard -- --client auto --apply
# or: node dist/cli.js onboard --apply
```

---

### Run proxy without `start` (advanced)

Prefer **`mastyf-ai start`** — it sets the same env vars automatically. Use `proxy` directly only when you need full control:

```bash
export DASHBOARD_ENABLED=true
export DASHBOARD_PORT=4000
export MASTYF_AI_DB_PATH="$HOME/.mastyf-ai/history.db"
mastyf-ai proxy --config mastyf-ai-configs/filesystem.json --policy default-policy.yaml --blocking-mode block
```

**From repo:**

```bash
node dist/cli.js proxy --config mastyf-ai-configs/filesystem.json --policy default-policy.yaml
```

Without `DASHBOARD_ENABLED`, you get proxy-only (no web UI). Logs still go to `MASTYF_AI_DB_PATH`.

---

### Generate test traffic and verify

With **`mastyf-ai start`** or `pnpm dashboard:proxy` running in one terminal:

```bash
# Same DB as the proxy (important for dashboard charts)
export MASTYF_AI_DB_PATH="${MASTYF_AI_DB_PATH:-$HOME/.mastyf-ai/history.db}"

# Short live attack smoke test against the official filesystem MCP server
pnpm real-life:filesystem

# Offline policy matrix (no live MCP server required)
pnpm harness

# Plain-English summary of current posture
pnpm analyze

# Industry roadmap module audit (CLI)
node dist/cli.js roadmap audit
# or after global link: mastyf-ai roadmap audit
```

Refresh **http://localhost:4000/** → **Activity** / **Protection** should show new events.

Details: [`scenarios/real-life/README.md`](scenarios/real-life/README.md).

---

### Website (cloud app) local dev

```bash
cp apps/cloud/.env.example apps/cloud/.env.local
# DATABASE_URL=postgresql://...
# AUTH_DEV_LOGIN=true

pnpm cloud:dev
# → http://localhost:3001
```

---

### mastyf.ai Autopilot (one-command fleet setup)

Wraps configs, starts proxy, dashboard, and optional background jobs:

```bash
pnpm autopilot:init -- --apply
pnpm autopilot:start
pnpm autopilot:status
```

---

### Web dashboard — what you will see

| Tab / area | Purpose |
| ---------- | ------- |
| **Protection** | Overall status, roadmap compliance strip (v4.1+) |
| **Activity** | Audit log of allowed and blocked `tools/call` |
| **Threats** | Active threats, quarantine, fleet chain graph (A1) |
| **Security** | Score, trends, and **Policy Studio** with Active Rules controls |
| **Operations** | Traffic, errors, cost charts; Security Swarm job status |
| **Agentic AI** | Trust, policy gen, observatory, federated learning, plan compliance audit |
| **Settings** | Servers, policy, setup checklist |

The dashboard reads the **same SQLite DB** as the proxy (`MASTYF_AI_DB_PATH`). It is not a separate demo dataset.

---

### Command reference

| Command | What it does |
| ------- | ------------ |
| `git clone … && pnpm install && pnpm build && pnpm setup` | Install from source (recommended today) |
| `mastyf-ai start` | **Proxy + dashboard on :4000** (after build or global link) |
| `mastyf-ai onboard --apply` | Auto-wrap MCP client configs |
| `mastyf-ai onboard --apply --start` | Onboard then start |
| `mastyf-ai setup` | Dev: pnpm install + build + dashboard SPA |
| `mastyf-ai doctor` | Validate install, DB, SPA, config |
| `mastyf-ai proxy --policy …` | Manual proxy (add `--config`) |
| `pnpm install && pnpm build` | Dev: install + compile monorepo |
| `pnpm setup` / `pnpm dashboard:build` | Dev: build dashboard SPA |
| `pnpm dashboard:proxy` | Dev: proxy + API + UI (repo script) |
| `pnpm dashboard:dev` | Dev: SPA hot reload (with proxy running) |
| `pnpm real-life:filesystem` | Live MCP attack smoke test |
| `pnpm harness` | Offline adversarial policy matrix |
| `pnpm analyze` | Plain-English security summary |
| `pnpm security-swarm:fast` | Security Swarm PR gate |
| `pnpm security-swarm:analyze` | Full swarm analysis |
| `pnpm autopilot:init` / `autopilot:start` | Wrap + start full stack |
| `mastyf-ai roadmap audit` | Verify industry roadmap modules (A1–C5) |
| `pnpm cloud:dev` | Run mastyf.ai website locally on :3001 |
| `pnpm cloud:deploy-now` | Deploy cloud app to Vercel |

---

### Troubleshooting

| Symptom | Fix |
| ------- | --- |
| **`mastyf-ai start` not found** | Build from clone: `pnpm build && node dist/cli.js start`. npm global install not available until `@mastyf-ai/server` is published. |
| **`pnpm dashboard:proxy` not found** | Run from **repo root**, or use **`node dist/cli.js start`** |
| **No MCP config found** | `mastyf-ai onboard --apply` or `mastyf-ai start --config mastyf-ai-configs/filesystem.json` |
| **Database disk I/O error** | Stop proxy; `rm -f ~/.mastyf-ai/history.db-wal history.db-shm history.db.pid`; restart |
| **Empty dashboard charts** | Same `MASTYF_AI_DB_PATH` as proxy; widen time window; `pnpm real-life:filesystem` |
| **Port 4000 in use** | `lsof -ti :4000 \| xargs kill` or `DASHBOARD_PORT=4001 mastyf-ai start` |
| **better-sqlite3 errors** (pnpm 10) | `pnpm approve-builds` → allow `better-sqlite3` → `pnpm install` |
| **Ollama warning on start** | Optional — `ollama serve` for semantic / Threat Lab |
| **Swarm stuck at 75%** | Check `reports/tenants/default/security-swarm/job.log`; re-run from dashboard |
| **Cloud sign-in fails locally** | Set `AUTH_DEV_LOGIN=true` and `DATABASE_URL` in `apps/cloud/.env.local` |
| **next: command not found** (dashboard build) | Run `pnpm setup` or `cd deploy/dashboard-spa && npm install && npm run build` |

---

## Quick start (summary)

**From git (recommended today):**

```bash
git clone https://github.com/mastyf-ai/mastyf.ai.git && cd mastyf.ai
pnpm install && pnpm build && pnpm setup
node dist/cli.js onboard --apply
node dist/cli.js start    # → http://localhost:4000/
```

**Use the website (no install):**

Open [https://mastyf-ai-cloud-jet.vercel.app/certified](https://mastyf-ai-cloud-jet.vercel.app/certified) and enter an npm MCP package name.

See **Getting started — install, clone, and run** above for the full walkthrough.

---

## The policy file

Rules live in `default-policy.yaml` (or a path you set). Example:

```yaml
version: '1.0'
policy:
  mode: block
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

The bundled default policy already blocks many common attack patterns. You can extend it or start from templates in [`policy-templates/`](policy-templates/).

---

## Settings you might change

| Variable | Plain meaning |
| -------- | ------------- |
| `MASTYF_AI_POLICY` | Path to your rules file |
| `MASTYF_AI_DB_PATH` | Where call history is stored (share this between proxy and test runners) |
| `MASTYF_AI_RETENTION_DAYS` | How long to keep audit rows (default 30) |
| `MASTYF_AI_MAX_PAYLOAD_BYTES` | Max raw JSON-RPC message size (default 10MB) |
| `MASTYF_AI_MAX_EXPANDED_PAYLOAD_BYTES` | Max serialized tool-argument size after decode (default 50MB) |
| `MASTYF_AI_JWKS_REFRESH_MS` | How often to refresh OIDC JWKS (default 5 minutes) |
| `MASTYF_AI_STRICT_ALLOWLIST_RBAC` | Require RBAC on `tools.allow` policy rules |
| `MASTYF_AI_HEALTH_PROBE_INTERVAL_MS` | Periodic MCP health probes (0 = disabled) |
| `MASTYF_AI_SHUTDOWN_GRACE_MS` | Wait for in-flight calls on shutdown (default 30s) |
| `MASTYF_AI_DB_ENCRYPTION_KEY` | Encrypt sensitive audit fields at rest |
| `MASTYF_AI_DB_ENCRYPT_AUDIT_ARGS` | Also encrypt redacted argument snippets in audit |
| `MASTYF_AI_SIEM_ENABLED` | Export block/audit events to Splunk, Datadog, webhooks, etc. |
| `DASHBOARD_PORT` | Dashboard port (default 4000) |
| `MASTYF_AI_DAILY_BUDGET_USD` | Daily spend alert threshold |
| `MASTYF_AI_LLM_PROVIDER` / `OLLAMA_BASE_URL` | Local AI for semantic checks and Threat Lab |
| `MASTYF_AI_CI_BYPASS_LICENSE` | Local dev only: skip license checks |
| `MASTYF_AI_REQUIRE_LICENSE` | Production: enforce cloud license (off by default) |

More: [`deploy/helm/`](deploy/helm/) for teams, Redis, and multiple servers.

---

## Supported AI clients

mastyf.ai can auto-discover and wrap configs for:

- **Cline** (VS Code)
- **Claude Desktop**
- **Cursor**
- **Windsurf**

Or pass any MCP config: `mastyf-ai proxy --config path/to/config.json`.

---

## Production deployment

### Docker

```bash
docker run -v $(pwd)/mcp.json:/etc/mastyf-ai/config.json \
  -v $(pwd)/policy.yaml:/etc/mastyf-ai/policy.yaml \
  ghcr.io/mastyf-ai/mastyf-ai:latest \
  proxy --config /etc/mastyf-ai/config.json --policy /etc/mastyf-ai/policy.yaml
```

### Kubernetes (Helm)

```bash
helm repo add mastyf-ai https://mastyf-ai.github.io/mastyf-ai
helm install mastyf-ai mastyf-ai/mastyf-ai
```

### Deploy cloud app to Vercel

```bash
export VERCEL_TOKEN="..."
export DATABASE_URL="postgresql://..."   # Neon — not localhost

pnpm cloud:migrate:prod
pnpm cloud:deploy-now
```

Verify: `APP_URL=https://mastyf-ai-cloud-jet.vercel.app pnpm cloud:verify-prod`

---

## Repo layout

```
mastyf.ai/
├── docs/assets/          # Logo + architecture diagrams (README & website)
├── apps/cloud/           # Next.js — scores, badges, cloud console (not on npm)
├── apps/proxy-core/      # Go data-plane proxy
├── packages/             # @mastyf-ai/core, plugin-sdk, mtx, cli
├── src/                  # Proxy, policy, agentic AI, CLI
├── deploy/               # Docker, Helm, embedded dashboard SPA
├── security-swarm/       # Autonomous red-team agents
├── adversarial-harness/  # ~835 attack fixtures & Node/Python harness
├── corpus/               # Policy evaluation corpus (~300 JSON entries)
├── mastyf-ai-configs/    # Example MCP configs for local dev
├── scenarios/real-life/  # Live MCP attack scenarios
└── scripts/              # Deploy, migrate, benchmarks
```

---

## Documentation map

| Topic | Document |
| ----- | -------- |
| **Architecture diagrams** | [`docs/assets/`](docs/assets/) (PNG sources + this README [§ explained](#architecture-diagrams-explained)) |
| Security Swarm | [`security-swarm/README.md`](security-swarm/README.md) |
| Adversarial harness | [`adversarial-harness/README.md`](adversarial-harness/README.md) |
| Corpus evaluation | [`corpus/README.md`](corpus/README.md) |
| Real-life MCP tests | [`scenarios/real-life/README.md`](scenarios/real-life/README.md) |
| MTX threat exchange | [`packages/mtx/README.md`](packages/mtx/README.md) |
| Packaging | [`packages/PACKAGING.md`](packages/PACKAGING.md) |
| Cloud deploy | [`apps/cloud/docs/VERCEL_DEPLOY.md`](apps/cloud/docs/VERCEL_DEPLOY.md) |
| Custom domain | [`apps/cloud/docs/CUSTOM_DOMAIN.md`](apps/cloud/docs/CUSTOM_DOMAIN.md) |
| Policy templates | [`policy-templates/README.md`](policy-templates/README.md) |

---

## License

**MIT** — see [LICENSE](LICENSE). All features in this repository are open source under the MIT license.

Optional enterprise license enforcement is available via `MASTYF_AI_REQUIRE_LICENSE=true` when linking to the mastyf.ai cloud control plane — it is **not required** for local or self-hosted use.

---

## Links

- **Website (live):** [mastyf-ai-cloud-jet.vercel.app](https://mastyf-ai-cloud-jet.vercel.app/)
- **GitHub:** [mastyf-ai/mastyf.ai](https://github.com/mastyf-ai/mastyf.ai)
- **npm (planned, not live yet):** `@mastyf-ai/server`
