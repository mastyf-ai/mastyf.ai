# 🩺 MCP Doctor

**Security, cost, and health audit for MCP infrastructure.**

MCP Doctor scans your Model Context Protocol (MCP) servers for security vulnerabilities, tracks real token costs via a proxy interceptor, and monitors health metrics. It works as both an MCP server (so Cline/Claude can call its tools) and a standalone CLI.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)](https://www.typescriptlang.org/)
[![MCP SDK](https://img.shields.io/badge/MCP_SDK-1.0-green)](https://github.com/modelcontextprotocol/typescript-sdk)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
[![CI](https://github.com/rudraneel93/mcp-doctor/actions/workflows/ci.yml/badge.svg)](https://github.com/rudraneel93/mcp-doctor/actions/workflows/ci.yml)

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
  - [Proxy Workflow (Real Cost Tracking)](#proxy-workflow-real-cost-tracking)
- [CLI Reference](#cli-reference)
  - [mcp-doctor proxy](#mcp-doctor-proxy)
  - [mcp-doctor scan](#mcp-doctor-scan)
  - [mcp-doctor audit](#mcp-doctor-audit)
  - [mcp-doctor health](#mcp-doctor-health)
  - [mcp-doctor report](#mcp-doctor-report)
- [MCP Server](#mcp-server-for-clineclaude-desktop)
- [CI/CD Integration](#cicd-integration)
- [Architecture](#architecture)
- [Config Discovery](#config-discovery)
- [Security Scoring](#security-scoring-model)
- [Pricing Models](#pricing-models)
- [Environment Variables](#environment-variables)
- [Development](#development)
- [Roadmap](#roadmap)
- [License](#license)

---

## Features

### 🔒 Security Scan (`scan_security`)
- **CVE Checking** — Queries [OSV.dev](https://osv.dev) (purl-based) and [NIST NVD](https://nvd.nist.gov) for known vulnerabilities. Rate-limited (5 req/min without API key, 20 req/min with key)
- **Auth Probing** — Detects missing authentication via env vars (`API_KEY`, `AUTH_TOKEN`, etc.) and URL credentials
- **Transport Security** — Flags unencrypted transports (HTTP, WS) and validates TLS certificates (expiry, issuer, validity)
- **Typo-Squat Detection** — Levenshtein distance matching against 24 known official MCP packages
- **Secret Scanning** — 6 regex patterns for hardcoded API keys, tokens, private keys, passwords, GitHub tokens, OpenAI keys
- **Scoring** — Weighted 0–100 security score with actionable recommendations

### 💰 Cost Audit (`audit_costs` — Zero Mock Data)
- **Proxy Interceptor** — `mcp-doctor proxy` sits between your AI client and MCP servers, capturing every `tools/call` request/response
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
- **Database Storage** — All scans, costs, health checks, and proxy-captured call records persisted in SQLite

### 🔧 Production Features
- **Dependency Injection** — IoC container (`src/container.ts`) for testability and runtime swaps
- **Rate Limiting** — Token-bucket rate limiter on OSV.dev and NVD API calls
- **Graceful Shutdown** — SIGINT/SIGTERM handlers flush DB and close connections
- **Batched DB Writes** — 1s debounced flush reduces I/O by 10x
- **Alert Thresholds** — 6 CLI flags with exit codes 1/2 for CI/CD integration
- **GitHub Actions CI** — Node 18/20/22 matrix, 62 unit tests across 9 suites

---

## Installation

```bash
git clone https://github.com/rudraneel93/mcp-doctor.git
cd mcp-doctor
npm install
npm run build
```

**Requirements:** Node.js ≥18, npm ≥9

---

## Quick Start

### Proxy Workflow (Real Cost Tracking)

The recommended workflow for getting real token cost data:

```bash
# 1. Start the proxy — it wraps your MCP servers and intercepts every tools/call
mcp-doctor proxy --config ./cline_mcp_settings.json

# 2. In another terminal, run your normal Cline/Claude workflows
#    Every tools/call is captured with real token counts

# 3. When done, Ctrl+C the proxy, then audit real costs
mcp-doctor audit --config ./cline_mcp_settings.json

# 4. Generate full report with real security + cost + health data
mcp-doctor report --config ./cline_mcp_settings.json
```

**Example output (real data from proxy):**
```
💰 Cost Audit
mcp-doctor: 161 tokens, $0.0016 (gpt-4o)
  audit_costs:   81 tokens, 1 call, $0.0008
  check_health:  80 tokens, 1 call, $0.0008

❤️ Health Check
mcp-doctor: 218ms latency, 100% success, 4 tools

Overall Score: 90/100
```

> **Important:** The cost audit will show `$0.0000` until the proxy has been running and captured real `tools/call` traffic. This is not a bug — the `call_records` table starts empty. See the [live pipeline verification](#live-pipeline-verification) below.

---

## Live Pipeline Verification

To verify the full pipeline works end-to-end with real data (no mocks):

```bash
# Terminal 1: Start the proxy
mcp-doctor proxy --config ./cline_mcp_settings.json

# Terminal 2: Run your AI workflows (or pipe test calls)

# Terminal 1: Ctrl+C when done, then:
mcp-doctor audit --config ./cline_mcp_settings.json
mcp-doctor report --config ./cline_mcp_settings.json
```

**Verified results** (proxy wrapping mcp-doctor's own MCP server, 3 real `tools/call` requests):

```
server: mcp-doctor, tool: scan_security,  124 tokens, 2463ms (real NVD API call)
server: mcp-doctor, tool: audit_costs,     83 tokens,    4ms
server: mcp-doctor, tool: check_health,    82 tokens,    4ms

💰 Cost Audit
mcp-doctor: 289 tokens, $0.0023 (gpt-4o)
  scan_security: 124 tokens, 1 call, $0.0010
  audit_costs:    83 tokens, 1 call, $0.0007
  check_health:   82 tokens, 1 call, $0.0007
```

---

## CLI Reference

### `mcp-doctor proxy`

Start the MCP proxy interceptor to capture real token usage data.

```bash
mcp-doctor proxy --config ./cline_mcp_settings.json
```

The proxy spawns all stdio MCP servers from config, then bridges stdin/stdout. Pipe JSON-RPC messages through it, or configure your AI client to connect via the proxy's stdio transport.

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Path to MCP config file |

### `mcp-doctor scan`

Run security scan on MCP servers. Detects CVEs, auth gaps, secrets, typo-squatting, and transport issues.

```bash
mcp-doctor scan
mcp-doctor scan --config ./config.json --fail-on-secrets
mcp-doctor scan --all --threshold-score 70
```

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Path to MCP config file |
| `-a, --all` | Aggregate all discoverable configs |
| `--threshold-score <n>` | Exit code 2 if any server score drops below `n` |
| `--fail-on-critical` | Exit code 1 if any critical CVE found |
| `--fail-on-secrets` | Exit code 1 if hardcoded secrets detected |

### `mcp-doctor audit`

Audit token costs. Reads real call records if proxy was used, otherwise shows zero-data note.

```bash
mcp-doctor audit
mcp-doctor audit --server github-server
mcp-doctor audit --threshold-cost 0.50
```

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Path to MCP config file |
| `-a, --all` | Aggregate all discoverable configs |
| `-s, --server <name>` | Filter to a specific server |
| `--threshold-cost <n>` | Exit code 2 if total cost exceeds `n` USD |

### `mcp-doctor health`

Check health, latency, and reliability of MCP servers. Uses real JSON-RPC handshake probes.

```bash
mcp-doctor health
mcp-doctor health --server filesystem
mcp-doctor health --threshold-latency 2000 --fail-on-overload
```

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Path to MCP config file |
| `-a, --all` | Aggregate all discoverable configs |
| `-s, --server <name>` | Filter to a specific server |
| `--threshold-latency <ms>` | Exit code 2 if any server exceeds latency threshold |
| `--fail-on-overload` | Exit code 1 if any server has tool overload (>15 tools) |

### `mcp-doctor report`

Generate a complete security, cost, and health report.

```bash
mcp-doctor report
mcp-doctor report --format markdown
mcp-doctor report --format json --config ~/.cursor/mcp.json
mcp-doctor report --all --threshold-score 60
```

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Path to MCP config file |
| `-a, --all` | Aggregate all discoverable configs |
| `-f, --format <fmt>` | Output format: `text`, `markdown`, or `json` |
| `--threshold-score <n>` | Exit code 2 if overall score drops below `n` |

---

## MCP Server (for Cline/Claude Desktop)

Add to your `cline_mcp_settings.json` or `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mcp-doctor": {
      "command": "node",
      "args": ["path/to/mcp-doctor/dist/index.js"]
    }
  }
}
```

Then Cline/Claude can invoke these tools:

| Tool | Parameters | Description |
|------|-----------|-------------|
| `scan_security` | `configPath?` | Scan MCP configs for CVEs, auth gaps, typo-squatting, and hardcoded secrets |
| `audit_costs` | `serverName?` | Estimate token usage and costs per server with multi-model pricing |
| `check_health` | `serverName?` | Check latency, success rate, tool count, and context pressure |
| `full_report` | `configPath?`, `format?` (json\|markdown\|text) | Generate complete audit report |

JSON format reports also include a structured `resource` content type for agent consumption.

---

## CI/CD Integration

Run in GitHub Actions to catch security issues before deployment:

```yaml
- name: MCP Doctor Security Scan
  run: npx mcp-doctor scan --config ./cline_mcp_settings.json --fail-on-critical --fail-on-secrets
  env:
    NVD_API_KEY: ${{ secrets.NVD_API_KEY }}
```

---

## Architecture

```
mcp-doctor/
├── src/
│   ├── index.ts                    # MCP server entry (stdio transport)
│   ├── cli.ts                      # CLI wrapper (5 commands: scan, audit, health, report, proxy)
│   ├── container.ts                # Dependency injection container
│   ├── types.ts                    # 13 shared TypeScript interfaces
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
│   │   ├── cve-checker.ts          # OSV.dev → NVD fallback chain
│   │   ├── auth-prober.ts          # Auth/transport detection (env + URL)
│   │   ├── typo-squat-detector.ts  # Levenshtein distance (O(n) memory)
│   │   └── secret-scanner.ts       # 6 regex patterns for secrets
│   │
│   ├── clients/                    # External API clients
│   │   ├── osv-client.ts           # api.osv.dev (purl-based, rate-limited)
│   │   ├── nvd-client.ts           # NIST NVD (API key, rate-limited)
│   │   └── pricing-client.ts       # 97 models, custom override support
│   │
│   ├── database/
│   │   └── history-db.ts           # SQLite via sql.js (4 tables, batched writes)
│   │
│   ├── reporter/
│   │   └── report-generator.ts     # Text, Markdown, JSON formatting
│   │
│   └── utils/
│       ├── token-counter.ts        # tiktoken (o200k_base) wrapper
│       ├── mcp-client.ts           # Full JSON-RPC 2.0 state machine + SSE probing
│       ├── rate-limiter.ts         # Token-bucket rate limiter
│       ├── tls-checker.ts          # TLS certificate validation
│       ├── scoring.ts              # Shared scoring utility
│       └── logger.ts              # Colored console logger
```

### Data Flow — Proxy → DB → Audit

```
AI Client (Cline/Claude)
        │
        │ tools/call JSON-RPC
        ▼
┌───────────────────┐
│ MCP Proxy Server  │ ← mcp-doctor proxy
│ (proxy-server.ts) │
└───────┬───────────┘
        │ counts tokens (tiktoken)
        ▼
┌───────────────────┐
│ call_records table │ ← SQLite
│ (history-db.ts)   │
└───────┬───────────┘
        │ async getCallRecordsForServer()
        ▼
┌───────────────────┐
│   Cost Auditor    │ ← mcp-doctor audit / report
│ (cost-auditor.ts) │
└───────────────────┘
        │ per-tool breakdown + multi-model pricing
        ▼
   Cost Report ($0.0023, gpt-4o)
```

---

## Config Discovery

MCP Doctor auto-discovers config files from these standard locations:

| Client | Config Path |
|--------|------------|
| **Cline (VS Code)** | `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |
| **Cline (VS Code Insiders)** | `~/Library/Application Support/Code - Insiders/User/globalStorage/.../cline_mcp_settings.json` |
| **Cline (Linux)** | `~/.config/Code/User/globalStorage/.../cline_mcp_settings.json` |
| **Cline (Windows)** | `%APPDATA%/Code/User/globalStorage/.../cline_mcp_settings.json` |
| **Claude Desktop (macOS)** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Claude Desktop (Linux)** | `~/.config/Claude/claude_desktop_config.json` |
| **Cursor** | `~/.cursor/mcp.json` |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json` |

Use `--config` / `configPath` for a custom path, or `--all` to aggregate all discoverable configs with deduplication.

---

## Security Scoring Model

Each server receives a score from 0–100 with these deductions:

| Finding | Deduction |
|---------|-----------|
| Critical CVEs detected | −40 |
| High-severity CVEs | −20 |
| Medium-severity CVEs | −10 |
| No authentication | −20 |
| Unencrypted transport | −10 |
| Typo-squat detected | −30 |
| Hardcoded secrets found | −15 |

**Letter grades:** A (80–100), B (60–79), C (40–59), D (0–39)

---

## Pricing Models

97 models across 17 providers. Cached rates per 1M tokens (as of mid-2025):

| Provider | Models | Example Rates |
|----------|--------|---------------|
| OpenAI (14) | gpt-4o, gpt-4.5-preview, o1, o3, o4-mini, gpt-3.5-turbo | $5/$15/M |
| Anthropic (8) | claude-3-5-sonnet, claude-opus, claude-haiku | $3/$15/M |
| Google (12) | gemini-2.5-pro, gemini-2.0-flash, gemma | $1.25/$10/M |
| DeepSeek (4) | deepseek-chat, deepseek-reasoner, deepseek-v3 | $0.14/$0.28/M |
| xAI/Grok (5) | grok-3, grok-3-mini | $3/$15/M |
| Meta/Llama (8) | llama-4-maverick, llama-3.3-70b | $0.2/$0.6/M |
| Mistral (9) | mistral-large, mixtral-8x22b, codestral | $2/$6/M |
| + 10 more providers | Cohere, AI21, Reka, Amazon, Alibaba, Zhipu, 01.AI, Writer, Perplexity, HuggingFace | |

Unknown models receive a conservative default estimate of $10/$30 per million tokens. Override via `PRICING_OVERRIDES` env var.

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `NVD_API_KEY` | NIST NVD API key for CVE lookups (20 req/min vs 5 without) |
| `MCP_DOCTOR_DB_PATH` | Override SQLite database path (default: `~/.mcp-doctor/history.db`) |
| `LOG_LEVEL` | Logging level: `DEBUG`, `INFO`, `WARN`, `ERROR` (default: `INFO`) |
| `PRICING_OVERRIDES` | Custom pricing JSON: `{"my-model": {"input": 2.0, "output": 6.0}}` |

---

## Development

```bash
# Clone and install
git clone https://github.com/rudraneel93/mcp-doctor.git
cd mcp-doctor
npm install

# Development
npm run dev       # Watch mode with tsx
npm run build     # Compile TypeScript
npm run lint      # Type check
npm test          # 52 unit tests
npm run test:watch # Watch mode

# Contributing
See CONTRIBUTING.md for guidelines on adding scanners, pricing models, and tests.
```

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
- [x] 52 unit tests (6 test suites)
- [x] GitHub Actions CI (Node 18/20/22 matrix)
- [ ] Publish to npm as `@rudraneel/mcp-doctor`

---

## License

MIT — see [LICENSE](LICENSE) for details.

**Built with TypeScript, @modelcontextprotocol/sdk, tiktoken, sql.js, and chalk.**