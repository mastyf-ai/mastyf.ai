# 🛡️ MCP Guardian

**Security, cost, and health audit for MCP infrastructure.**

[![npm version](https://img.shields.io/npm/v/@mcp-guardian/server)](https://www.npmjs.com/package/@mcp-guardian/server)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)](https://www.typescriptlang.org/)
[![MCP SDK](https://img.shields.io/badge/MCP_SDK-1.0-green)](https://github.com/modelcontextprotocol/typescript-sdk)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
[![CI](https://github.com/rudraneel93/mcp-guardian/actions/workflows/ci.yml/badge.svg)](https://github.com/rudraneel93/mcp-guardian/actions/workflows/ci.yml)

MCP Guardian scans your [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) servers for security vulnerabilities, tracks real token costs via a proxy interceptor, and monitors health metrics. It works as both an **MCP server** (so AI assistants like Cline/Claude can invoke its tools) and a **standalone CLI**.

---

## Table of Contents

- [Why MCP Guardian?](#why-mcp-guardian)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
  - [Proxy Workflow (Real Cost Tracking)](#proxy-workflow-real-cost-tracking)
  - [One-Off Scan](#one-off-scan)
- [CLI Reference](#cli-reference)
  - [`mcp-guardian proxy`](#mcp-guardian-proxy)
  - [Policy Engine (v0.4+)](#policy-engine-v04)
  - [`mcp-guardian scan`](#mcp-guardian-scan)
  - [`mcp-guardian audit`](#mcp-guardian-audit)
  - [`mcp-guardian health`](#mcp-guardian-health)
  - [`mcp-guardian report`](#mcp-guardian-report)
- [MCP Server (AI Assistant Integration)](#mcp-server-ai-assistant-integration)
  - [Available Tools](#available-tools)
  - [Available Resources & Prompts](#available-resources--prompts)
- [CI/CD Integration](#cicd-integration)
- [Production Deployment (K8s + Helm)](#production-deployment-k8s--helm)
- [Docker](#docker)
- [Architecture](#architecture)
  - [Data Flow (Proxy → DB → Audit)](#data-flow-proxy--db--audit)
- [Config Discovery](#config-discovery)
- [Security Scoring Model](#security-scoring-model)
- [Pricing Models](#pricing-models)
- [Environment Variables](#environment-variables)
- [Development](#development)
- [SECURITY.md](#securitymd)
- [FAQ](#faq)
- [Roadmap](#roadmap)
- [License](#license)

---

## Why MCP Guardian?

As MCP adoption grows, so does the attack surface. MCP servers run arbitrary commands, access filesystems, make network calls, and handle sensitive data — often with zero visibility into their security posture or operational cost.

MCP Guardian provides:

- **Active policy enforcement (v0.4+)** — YAML-configurable policy engine that blocks, flags, or passes every `tools/call` in real time based on tool allowlists/denylists, regex patterns, rate limits, and token budgets
- **Security auditing** — CVE scanning (OSV.dev + NVD), hardcoded secret detection, typo-squatting detection, command injection detection, and TLS validation
- **Real cost tracking** — Proxy interceptor that captures actual `tools/call` traffic and counts tokens via `tiktoken` (o200k_base encoding) — no estimates, no mocks
- **Health monitoring** — Live JSON-RPC 2.0 handshake probes with latency, success rate, tool count, and context pressure analysis
- **Agent-native** — Runs as an MCP server so your AI assistant can self-audit its own infrastructure
- **Enterprise SIEM logging (v0.4+)** — Structured JSON logs via pino with request-ID tracing, policy decision audit trails, and block events at WARN level

---

## Features

### 🔒 Security Scan (`scan_security`)

| Check | Description |
|---|---|
| **CVE Checking** | Queries [OSV.dev](https://osv.dev) (purl-based) and [NIST NVD](https://nvd.nist.gov) for known vulnerabilities. Rate-limited (5 req/min without API key, 20 req/min with key) |
| **Auth Probing** | Detects missing authentication via env vars (`API_KEY`, `AUTH_TOKEN`, etc.) and URL credentials |
| **Transport Security** | Flags unencrypted transports (HTTP, WS) and validates TLS certificates (expiry, issuer, validity) |
| **Typo-Squat Detection** | Levenshtein distance matching against 24 known official MCP packages |
| **Secret Scanning** | 6 regex patterns for hardcoded API keys, tokens, private keys, passwords, GitHub tokens, OpenAI keys |
| **Command Validation** | Flags dangerous patterns (path traversal, shell chaining, `rm -rf`, `curl`/`wget` in commands, and more) |
| **🔴 Active Policy Engine (v0.4+)** | YAML-configurable rules: tool allowlist/denylist, regex pattern blocking, rate limiting, token budgets. Operates in `audit` (passive), `warn` (flag only), or `block` (active enforcement) modes |
| **Scoring** | Weighted 0–100 security score with actionable recommendations |

### 💰 Cost Audit (`audit_costs`)

- **Proxy Interceptor** — `mcp-guardian proxy` sits between your AI client and MCP servers, capturing every `tools/call` request/response
- **Real Token Counting** — Uses `tiktoken` (o200k_base encoding) on actual JSON-RPC traffic — no hardcoded estimates
- **Multi-Model Pricing** — 97 models across 17 providers (OpenAI, Anthropic, Google, DeepSeek, xAI, Meta, Mistral, and more)
- **Tool-Level Breakdown** — Per-tool token usage, call counts, duration, and cost estimates
- **Custom Pricing** — Override via `PRICING_OVERRIDES` env var: `{"my-model": {"input": 2.0, "output": 6.0}}`

### ❤️ Health Monitor (`check_health`)

- **Live Probes** — Full JSON-RPC 2.0 handshake (initialize → initialized → `tools/list`) with request/response correlation
- **SSE Probing** — Multi-path discovery (`/`, `/sse`, `/message`) with auth header injection and timeout handling
- **Latency Tracking** — End-to-end latency per server with historical success rates from SQLite
- **Overload Detection** — Warns when >15 tools exposed; context pressure estimation

### 📊 Full Report (`full_report`)

- **Three Output Formats** — Colored text, Markdown tables, structured JSON (with `resource` MIME type for agent consumption)
- **Overall Score** — Composite security + health score (0–100)
- **Database Storage** — All scans, costs, health checks, and proxy-captured call records persisted in SQLite (4 tables, batched writes)

### 🔧 Production Features

- **Dependency Injection** — IoC container (`src/container.ts`) for testability and runtime swaps
- **Rate Limiting** — Token-bucket rate limiter on OSV.dev and NVD API calls
- **Graceful Shutdown** — SIGINT/SIGTERM handlers flush DB and close connections
- **Batched DB Writes** — 1s debounced flush reduces I/O by 10x
- **Alert Thresholds** — 6 CLI flags with exit codes 1/2 for CI/CD integration
- **GitHub Actions CI** — Node 18/20/22 matrix, 74 tests across 11 suites

---

## Installation

### From npm (recommended)

```bash
npm install -g @mcp-guardian/server
```

After global install, the `mcp-guardian` command is available in your PATH.

### From source

```bash
git clone https://github.com/rudraneel93/mcp-guardian.git
cd mcp-guardian
npm install
npm run build
```

**Requirements:** Node.js ≥ 18, npm ≥ 9

---

## Quick Start

### Proxy Workflow (Real Cost Tracking)

The recommended workflow for getting real token cost data:

```bash
# 1. Start the proxy — it wraps your MCP servers and intercepts every tools/call
mcp-guardian proxy --config ./cline_mcp_settings.json

# 2. In another terminal, run your normal Cline/Claude workflows
#    Every tools/call is captured with real token counts

# 3. When done, Ctrl+C the proxy, then audit real costs
mcp-guardian audit --config ./cline_mcp_settings.json

# 4. Generate full report with real security + cost + health data
mcp-guardian report --config ./cline_mcp_settings.json
```

**Example output (real data from proxy against 3 MCP servers):**

```
💰 Cost Audit
github:      194 tokens, $0.0018 (gpt-4o)
filesystem:  245 tokens, $0.0026 (gpt-4o)
puppeteer:   216 tokens, $0.0021 (gpt-4o)
Total estimated cost: $0.0065

❤️ Health Check
github:      902ms latency,  100% success, 26 tools
filesystem: 1253ms latency,  100% success, 14 tools
puppeteer:  1275ms latency,  100% success,  7 tools

🔒 Security Scan
github - Score: D (0)  — 20 CVEs, hardcoded token detected
filesystem - Score: C (50) — 20 CVEs, needs auth
puppeteer - Score: D (10) — 3 CVEs (1 critical), needs auth

Overall Score: 60/100
```

> **Important:** The cost audit will show `$0.0000` until the proxy has been running and captured real `tools/call` traffic. This is not a bug — the `call_records` table starts empty.

### One-Off Scan

```bash
# Quick security scan on auto-discovered configs
mcp-guardian scan

# Scan with thresholds for CI
mcp-guardian scan --config ./cline_mcp_settings.json --fail-on-critical --fail-on-secrets --threshold-score 70

# Check health
mcp-guardian health --server github-server --fail-on-overload --threshold-latency 2000

# Generate a Markdown report for documentation
mcp-guardian report --format markdown --output audit-report.md
```

---

## CLI Reference

### `mcp-guardian proxy`

Start the MCP proxy interceptor with optional active policy enforcement.

```bash
# Audit-only (passive)
mcp-guardian proxy --config ./cline_mcp_settings.json

# Active blocking with default policy
mcp-guardian proxy --config ./cline_mcp_settings.json --policy ./default-policy.yaml

# Active blocking with custom policy + mode override
mcp-guardian proxy --config ./cline_mcp_settings.json --policy ./my-policy.yaml --blocking-mode block
```

| Option | Description |
|---|---|
| `-c, --config <path>` | Path to MCP config file |
| `--policy <path>` | Path to policy YAML file (enables active blocking) |
| `--blocking-mode <mode>` | Override policy mode: `audit` (passive), `warn` (flag), `block` (enforce) |

### Policy Engine (v0.4+)

The policy engine evaluates every intercepted `tools/call` before it reaches the MCP server. Define rules in YAML:

```yaml
# my-policy.yaml
version: "1.0"
policy:
  mode: block
  rules:
    - name: "deny-shell-tools"
      action: block
      tools: { deny: ["execute_command", "bash", "sh", "eval", "exec"] }
    - name: "block-injection"
      action: block
      patterns:
        - "rm\\s+-rf"
        - "curl\\s|wget\\s"
        - ";\\s*\\w"
        - "&&|\\|\\|"
    - name: "rate-limit"
      action: flag
      maxCallsPerMinute: 60
    - name: "token-budget"
      action: flag
      maxTokens: 50000
```

**Blocked calls** return a JSON-RPC 2.0 error to the client:
```json
{"jsonrpc":"2.0","id":"abc-123","error":{"code":-32001,"message":"Blocked by MCP Guardian policy: Tool 'execute_command' is explicitly denied"}}
```

**Policy modes:**
| Mode | Behavior |
|---|---|
| `audit` | Pass all calls; log decisions only (passive) |
| `warn` | Downgrade `block` actions to `flag`; log warnings |
| `block` | Full active enforcement — blocked calls never reach the MCP server |

### `mcp-guardian scan`

Run security scan on MCP servers.

```bash
mcp-guardian scan
mcp-guardian scan --config ./config.json --fail-on-secrets
mcp-guardian scan --all --threshold-score 70
```

| Option | Description |
|---|---|
| `-c, --config <path>` | Path to an MCP config file |
| `-a, --all` | Aggregate all discoverable configs |
| `--threshold-score <n>` | Exit code 2 if any server score drops below `n` |
| `--fail-on-critical` | Exit code 1 if any critical CVE found |
| `--fail-on-secrets` | Exit code 1 if hardcoded secrets detected |

### `mcp-guardian audit`

Audit token costs. Reads real call records if proxy was used, otherwise shows zero-data note.

```bash
mcp-guardian audit
mcp-guardian audit --server github-server
mcp-guardian audit --threshold-cost 0.50
```

| Option | Description |
|---|---|
| `-c, --config <path>` | Path to an MCP config file |
| `-a, --all` | Aggregate all discoverable configs |
| `-s, --server <name>` | Filter to a specific server |
| `--threshold-cost <n>` | Exit code 2 if total cost exceeds `n` USD |

### `mcp-guardian health`

Check health, latency, and reliability of MCP servers. Uses real JSON-RPC handshake probes.

```bash
mcp-guardian health
mcp-guardian health --server filesystem
mcp-guardian health --threshold-latency 2000 --fail-on-overload
```

| Option | Description |
|---|---|
| `-c, --config <path>` | Path to an MCP config file |
| `-a, --all` | Aggregate all discoverable configs |
| `-s, --server <name>` | Filter to a specific server |
| `--threshold-latency <ms>` | Exit code 2 if any server exceeds latency threshold |
| `--fail-on-overload` | Exit code 1 if any server has tool overload (>15 tools) |

### `mcp-guardian report`

Generate a complete security, cost, and health report.

```bash
mcp-guardian report
mcp-guardian report --format markdown
mcp-guardian report --format json --config ~/.cursor/mcp.json
mcp-guardian report --all --threshold-score 60
```

| Option | Description |
|---|---|
| `-c, --config <path>` | Path to an MCP config file |
| `-a, --all` | Aggregate all discoverable configs |
| `-f, --format <fmt>` | Output format: `text` (default), `markdown`, or `json` |
| `--output <path>` | Save report to a file instead of stdout |
| `--threshold-score <n>` | Exit code 2 if overall score drops below `n` |

---

## MCP Server (AI Assistant Integration)

Add to your `cline_mcp_settings.json` or `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mcp-guardian": {
      "command": "npx",
      "args": ["-y", "@mcp-guardian/server"]
    }
  }
}
```

Or with a local install:

```json
{
  "mcpServers": {
    "mcp-guardian": {
      "command": "node",
      "args": ["path/to/mcp-guardian/dist/index.js"]
    }
  }
}
```

### Available Tools

| Tool | Parameters | Description |
|---|---|---|
| `scan_security` | `configPath?` | Scan MCP configs for CVEs, auth gaps, typo-squatting, hardcoded secrets, and dangerous commands |
| `audit_costs` | `serverName?` | Estimate token usage and costs per server with multi-model pricing |
| `check_health` | `serverName?` | Check latency, success rate, tool count, and context pressure |
| `full_report` | `configPath?`, `format?` (json\|markdown\|text) | Generate complete audit report in any format |

JSON format reports also include a structured `resource` content type (MIME: `application/json`) so AI assistants can consume reports programmatically.

### Available Resources & Prompts

- **Resource:** `mcp-guardian://latest-scan` — exposes the most recent security scan as structured JSON
- **Prompt:** `audit-config` — generates structured audit instructions for an MCP config path, which the assistant can use to guide its investigation

---

## CI/CD Integration

Run MCP Guardian in CI to catch issues before deployment:

```yaml
- name: MCP Guardian Security Scan
  run: npx @mcp-guardian/server scan --config ./cline_mcp_settings.json --fail-on-critical --fail-on-secrets
  env:
    NVD_API_KEY: ${{ secrets.NVD_API_KEY }}

- name: MCP Guardian Cost Audit
  run: npx @mcp-guardian/server audit --all --threshold-cost 0.50

- name: MCP Guardian Health Check
  run: npx @mcp-guardian/server health --all --threshold-latency 3000 --fail-on-overload
```

### Exit Codes

| Code | Meaning |
|---|---|
| 0 | All checks passed within thresholds |
| 1 | Critical security issue found (critical CVE, secret, overload) |
| 2 | Threshold exceeded (score, cost, or latency below/above limit) |

---

## Production Deployment (K8s + Helm)

See the full guide at **[deploy/PRODUCTION.md](deploy/PRODUCTION.md)**.

### Quick Helm Install

```bash
# Install from local chart
helm install mcp-guardian ./deploy/helm/mcp-guardian \
  --set config.policy.mode=block \
  --set config.mcpConfigPath=/etc/mcp-guardian/cline_mcp_settings.json

# Or from the repo (future)
helm repo add mcp-guardian https://rudraneel93.github.io/mcp-guardian
helm install mcp-guardian mcp-guardian/mcp-guardian
```

### Key Features
- **Helm chart** with ConfigMap-backed policies, PVC persistence, and safe defaults
- **Fail-closed** by default (block traffic if proxy crashes) — configurable to fail-open
- **Sidecar injection pattern** documented for stdio MCP servers
- **Scaling guide** with CPU/memory recommendations per traffic level
- **Pod Disruption Budget** for HA, anti-affinity for multi-AZ
- **SIEM integration** via pino structured JSON logs (Splunk, Datadog, Elasticsearch)

### Performance Overhead

| Scenario | p50 | p99 | Overhead |
|----------|-----|-----|----------|
| Direct MCP (no proxy) | 5ms | 7ms | — |
| Proxy (no policy) | 27ms | 77ms | +25.78ms |
| Proxy (blocking policy) | 27ms | 74ms | +25.93ms |

Policy engine adds **~0.15ms** — negligible. The ~26ms is Node.js child process stdio overhead.

## Docker

A Docker image is available for running the proxy in containerized environments.

```bash
# Build
docker build -t mcp-guardian .

# Run proxy
docker run -i \
  -v $(pwd)/cline_mcp_settings.json:/app/cline_mcp_settings.json \
  -v mcp-guardian-db:/root/.mcp-guardian \
  mcp-guardian --config /app/cline_mcp_settings.json
```

The `Dockerfile` uses `node:20-alpine` and runs `mcp-guardian proxy` as the default entrypoint.

---

## Architecture

```
mcp-guardian/
├── src/
│   ├── index.ts                    # MCP server entry (stdio transport)
│   ├── cli.ts                      # CLI wrapper (5 commands: proxy, scan, audit, health, report)
│   ├── container.ts                # Dependency injection container (IoC)
│   ├── types.ts                    # Shared TypeScript interfaces (8 types)
│   ├── config-parser.ts            # Multi-format config parsing with multi-file aggregation
│   │
│   ├── proxy/                      # MCP Proxy Interceptor (real cost engine)
│   │   ├── proxy-server.ts         # Intercepts tools/call, counts tokens via tiktoken
│   │   └── proxy-manager.ts        # Spawns proxies for all stdio servers
│   │
│   ├── services/                   # Orchestrators
│   │   ├── security-scanner.ts     # Parallel security checks + weighted scoring
│   │   ├── cost-auditor.ts         # Reads real call_records from DB (zero mock data)
│   │   └── health-monitor.ts       # Live JSON-RPC probing + DB integration
│   │
│   ├── scanners/                   # Individual security checks
│   │   ├── cve-checker.ts          # OSV.dev → NVD fallback chain (rate-limited)
│   │   ├── auth-prober.ts          # Auth/transport detection (env + URL patterns)
│   │   ├── typo-squat-detector.ts  # Levenshtein distance (O(n) memory)
│   │   ├── secret-scanner.ts       # 6 regex patterns for secrets
│   │   └── command-validator.ts    # 10 suspicious pattern checks for command injection
│   │
│   ├── clients/                    # External API clients
│   │   ├── osv-client.ts           # api.osv.dev (purl-based, token-bucket rate-limited)
│   │   ├── nvd-client.ts           # NIST NVD (API key support, rate-limited)
│   │   └── pricing-client.ts       # 97 models, 17 providers, custom override support
│   │
│   ├── database/
│   │   └── history-db.ts           # SQLite via sql.js (4 tables, batched writes, 1s debounce)
│   │
│   ├── reporter/
│   │   └── report-generator.ts     # Text, Markdown, JSON formatting
│   │
│   └── utils/
│       ├── token-counter.ts        # tiktoken (o200k_base) wrapper
│       ├── mcp-client.ts           # Full JSON-RPC 2.0 state machine + SSE probing
│       ├── rate-limiter.ts         # Token-bucket rate limiter
│       ├── tls-checker.ts          # TLS certificate validation (expiry, issuer, chain)
│       ├── scoring.ts              # Shared scoring utility
│       └── logger.ts              # Colored console logger with log levels
│
tests/                              # 74 tests across 11 suites (Vitest)
├── config-parser.test.ts
├── secret-scanner.test.ts
├── auth-prober.test.ts
├── typo-squat-detector.test.ts
├── scoring.test.ts
├── pricing-client.test.ts
├── services/
│   ├── cost-auditor.test.ts
│   └── security-scanner.test.ts
└── integration/
    ├── proxy-audit.test.ts
    └── full-pipeline.test.ts
```

### Data Flow (Proxy → DB → Audit)

```
AI Client (Cline/Claude)
        │
        │ tools/call JSON-RPC
        ▼
┌───────────────────┐
│ MCP Proxy Server  │ ← mcp-guardian proxy
│ (proxy-server.ts) │
└───────┬───────────┘
        │ counts tokens (tiktoken o200k_base)
        ▼
┌───────────────────┐
│ call_records table │ ← SQLite (sql.js)
│ (history-db.ts)   │
└───────┬───────────┘
        │ async getCallRecordsForServer()
        ▼
┌───────────────────┐
│   Cost Auditor    │ ← mcp-guardian audit / report
│ (cost-auditor.ts) │
└───────────────────┘
        │ per-tool breakdown + multi-model pricing (97 models)
        ▼
   Cost Report ($0.0023, gpt-4o)
```

---

## Config Discovery

MCP Guardian auto-discovers config files from these standard locations:

| Client | Config Path |
|---|---|
| **Cline (VS Code)** | `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |
| **Cline (VS Code Insiders)** | `~/Library/Application Support/Code - Insiders/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |
| **Cline (Linux)** | `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |
| **Cline (Windows)** | `%APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |
| **Claude Desktop (macOS)** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Claude Desktop (Linux)** | `~/.config/Claude/claude_desktop_config.json` |
| **Cursor** | `~/.cursor/mcp.json` |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json` |

Use `--config` / `-c` for a custom path, or `--all` / `-a` to aggregate all discoverable configs with deduplication (first file wins for duplicate server names).

---

## Security Scoring Model

Each server receives a score from 0–100 with these deductions:

| Finding | Deduction |
|---|---|
| Critical CVEs detected | −40 |
| High-severity CVEs | −20 |
| Medium-severity CVEs | −10 |
| No authentication | −20 |
| Unencrypted transport | −10 |
| Typo-squat detected | −30 |
| Hardcoded secrets found | −15 |
| High-severity command warning | −25 |
| Medium-severity command warning | −10 |

**Letter grades:** A (80–100), B (60–79), C (40–59), D (0–39)

---

## Pricing Models

97 models across 17 providers. Cached rates per 1M tokens (as of mid-2025):

| Provider | Models | Example Rates (input/output per 1M) |
|---|---|---|
| OpenAI (14) | gpt-4o, gpt-4.5-preview, o1, o3, o4-mini, gpt-3.5-turbo | $5/$15 |
| Anthropic (8) | claude-3-5-sonnet, claude-opus, claude-haiku | $3/$15 |
| Google (12) | gemini-2.5-pro, gemini-2.0-flash, gemma | $1.25/$10 |
| DeepSeek (4) | deepseek-chat, deepseek-reasoner, deepseek-v3 | $0.14/$0.28 |
| xAI/Grok (5) | grok-3, grok-3-mini | $3/$15 |
| Meta/Llama (8) | llama-4-maverick, llama-3.3-70b | $0.2/$0.6 |
| Mistral (9) | mistral-large, mixtral-8x22b, codestral | $2/$6 |
| + 10 more | Cohere, AI21, Reka, Amazon, Alibaba, Zhipu, 01.AI, Writer, Perplexity, HuggingFace | varies |

Unknown models receive a conservative default estimate of $10/$30 per million tokens. Override any model via the `PRICING_OVERRIDES` env var.

---

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `NVD_API_KEY` | NIST NVD API key for CVE lookups (20 req/min vs 5 without) | (none) |
| `MCP_GUARDIAN_DB_PATH` | Override SQLite database path | `~/.mcp-guardian/history.db` |
| `LOG_LEVEL` | Logging level: `DEBUG`, `INFO`, `WARN`, `ERROR` | `INFO` |
| `PRICING_OVERRIDES` | Custom pricing JSON: `{"my-model": {"input": 2.0, "output": 6.0}}` | (none) |
| `OPENAI_API_KEY` | Optionally used by tiktoken for token counting | (none) |

---

## Development

```bash
# Clone and install
git clone https://github.com/rudraneel93/mcp-guardian.git
cd mcp-guardian
npm install

# Development
npm run dev          # Watch mode with tsx
npm run build        # Compile TypeScript
npm run lint         # Type check (tsc --noEmit)
npm test             # 74 tests across 11 suites (Vitest)
npm run test:watch   # Watch mode

# Contributing
# See CONTRIBUTING.md for guidelines on adding scanners, pricing models, and tests.
```

---

## FAQ

### Why does `mcp-guardian audit` show $0.0000?

The cost audit reads real data from the proxy's database. You must run `mcp-guardian proxy` first to capture `tools/call` traffic, then run `audit`. Without proxy data, the `call_records` table is empty and the audit returns zero.

### Do I need an NVD API key?

No, but you'll be rate-limited to 5 requests per minute without one. Get a free key at [NIST NVD](https://nvd.nist.gov/developers/request-an-api-key) for 20 req/min.

### How do I run the proxy alongside my AI assistant?

Start `mcp-guardian proxy --config <path>` in one terminal, then run your AI assistant normally in another. The proxy sits between the assistant and MCP servers, transparently capturing all `tools/call` traffic.

### What does the proxy intercept?

The proxy only tracks `tools/call` JSON-RPC messages — it counts input tokens (the request) and output tokens (the response). It forwards all other messages without tracking.

### Can I use MCP Guardian with SSE/HTTP transports?

The security scan and health monitor support SSE/HTTP transports. The proxy currently supports **stdio** transports only (it spawns child processes). Cost auditing via proxy works only for stdio-based MCP servers.

### How do I override pricing for my custom model?

Set the `PRICING_OVERRIDES` environment variable with JSON:

```bash
export PRICING_OVERRIDES='{"my-custom-model": {"input": 2.0, "output": 6.0}}'
```

Rates are in USD per 1 million tokens.

### Where is the database stored?

By default, SQLite data is stored at `~/.mcp-guardian/history.db`. Override with the `MCP_GUARDIAN_DB_PATH` environment variable. The database has 4 tables: `security_scans`, `cost_records`, `health_checks`, and `call_records`.

### What's the difference between `--config` and `--all`?

- `--config <path>` loads a single config file
- `--all` auto-discovers and aggregates all config files from known locations (Cline, Claude Desktop, Cursor, Windsurf), deduplicating servers by name

### Can I run MCP Guardian in CI/CD?

Yes. Use the alert threshold flags (`--fail-on-critical`, `--fail-on-secrets`, `--threshold-score`, etc.) which return non-zero exit codes that CI systems understand. See the [CI/CD Integration](#cicd-integration) section for examples.

### How accurate is the token counting?

Token counting uses `tiktoken` with the `o200k_base` encoding (used by GPT-4o and many modern models). For non-OpenAI models, this provides a close approximation since most modern tokenizers are similar in granularity.

---

## Roadmap

- [x] Core security, cost, and health scanning
- [x] MCP server + CLI dual entry points (5 commands)
- [x] NVD + OSV.dev CVE integration (rate-limited)
- [x] SQLite history tracking (4 tables, batched writes)
- [x] Real MCP handshake probing (JSON-RPC 2.0 state machine)
- [x] SSE/HTTP transport support (multi-path discovery)
- [x] Custom pricing configuration (`PRICING_OVERRIDES` env var)
- [x] Alert thresholds with exit codes (6 flags)
- [x] Multiple config file aggregation (`--all` + deduplication)
- [x] MCP Proxy Interceptor — real token capture with zero mock data
- [x] Dependency injection container (IoC pattern)
- [x] Token-bucket rate limiter (OSV + NVD)
- [x] TLS certificate validation
- [x] Command injection validation (10 suspicious patterns)
- [x] Active policy engine — YAML-based pass/block/flag with allowlists, regex, rate limiting, token budgets
- [x] Structured JSON logging (pino) for SIEM ingestion
- [x] STRIDE threat model (SECURITY.md)
- [x] 74 tests (11 suites)
- [x] GitHub Actions CI (Node 18/20/22 matrix)
- [x] Performance benchmarks (p50: 5ms baseline, +25.78ms proxy overhead, +0.15ms policy)
- [x] Helm chart + production deployment guide (K8s, fail-open/closed, sidecar pattern, scaling)
- [x] Published to npm as [`@mcp-guardian/server`](https://www.npmjs.com/package/@mcp-guardian/server)
- [ ] OPA integration for Rego policies
- [ ] OAuth 2.1 / OIDC proxy authentication
- [ ] Web dashboard for historical trends
- [ ] Slack/Discord alerting
- [ ] Prometheus metrics endpoint
- [ ] Multi-user proxy

---

## License

MIT — see [LICENSE](LICENSE) for details.

**Built with TypeScript, @modelcontextprotocol/sdk, tiktoken, sql.js, commander, chalk, and zod.**