# 🩺 MCP Doctor

**Security, cost, and health audit for MCP infrastructure.**

MCP Doctor scans your Model Context Protocol (MCP) servers for security vulnerabilities, tracks token costs, and monitors health metrics. It works as both an MCP server (so Cline/Claude can call its tools) and a standalone CLI.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)](https://www.typescriptlang.org/)
[![MCP SDK](https://img.shields.io/badge/MCP_SDK-1.0-green)](https://github.com/modelcontextprotocol/typescript-sdk)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
  - [CLI](#cli)
  - [MCP Server](#mcp-server-for-clineclaude-desktop)
  - [CI/CD Integration](#cicd-integration)
- [Architecture](#architecture)
- [Config Discovery](#config-discovery)
- [Security Scoring](#security-scoring-model)
- [Pricing Models](#pricing-models)
- [Development](#development)
- [Roadmap](#roadmap)
- [License](#license)

---

## Features

### 🔒 Security Scan (`scan_security`)
- **CVE Checking** — Queries [OSV.dev](https://osv.dev) (purl-based) and [NIST NVD](https://nvd.nist.gov) for known vulnerabilities
- **Auth Probing** — Detects missing authentication by scanning environment variables and URL credentials
- **Transport Security** — Flags unencrypted transports (HTTP, WS vs HTTPS, WSS)
- **Typo-Squat Detection** — Levenshtein distance matching against 24 known official MCP packages
- **Secret Scanning** — Regex-based detection of hardcoded API keys, tokens, private keys, passwords, GitHub tokens, and OpenAI keys
- **Scoring** — Weighted 0–100 security score with actionable recommendations

### 💰 Cost Audit (`audit_costs`)
- **Token Counting** — Uses `tiktoken` (o200k_base encoding) for accurate GPT-4o token estimation
- **Multi-Model Pricing** — Cached rates for GPT-4o, GPT-4o-mini, Claude 3.5 Sonnet, Claude Haiku, DeepSeek, Gemini Flash
- **Tool-Level Breakdown** — Per-tool token usage, call counts, and cost estimates
- **70/30 Split** — Default input/output token split for cost calculation

### ❤️ Health Monitor (`check_health`)
- **Latency Tracking** — End-to-end latency measurement per server
- **Success Rate** — Historical success rate from SQLite history (last 10 checks, weighted)
- **Context Pressure** — Estimated context window pressure based on tool count
- **Overload Detection** — Warns when a server exposes >15 tools (empirical threshold)
- **Tool Count** — Estimates exposed tool count via MCP probe

### 📊 Full Report (`full_report`)
- **Three Output Formats** — Colored text (terminal), Markdown tables, and structured JSON
- **Overall Score** — Composite score averaging security and health metrics
- **Database Storage** — All scan results persisted in SQLite for trend analysis

---

## Installation

```bash
# Global install
npm install -g @mcp-doctor/server

# Or run directly
npx @mcp-doctor/server
```

**Requirements:** Node.js ≥18, npm ≥9

---

## Usage

### CLI

```bash
# ── Security Scan ──────────────────────────────────
mcp-doctor scan
mcp-doctor scan --config ./path/to/cline_mcp_settings.json

# ── Cost Audit ─────────────────────────────────────
mcp-doctor audit
mcp-doctor audit --server github-server

# ── Health Check ───────────────────────────────────
mcp-doctor health
mcp-doctor health --server filesystem

# ── Full Report ────────────────────────────────────
mcp-doctor report                              # Colored text
mcp-doctor report --format markdown            # Markdown tables
mcp-doctor report --format json                # Structured JSON
mcp-doctor report --config ~/.cursor/mcp.json --format markdown
```

**Example output (colored text):**
```
═══════════════════════════════════════════
  MCP Doctor Report
  2026-05-08T15:26:04.245Z
  Config: test-config.json
═══════════════════════════════════════════

🔒 Security Scan Results

github - Score: D (0)
  CVEs: 20 found
    [CRITICAL] CVE-2017-15994: rsync mishandles archaic checksums
    [CRITICAL] CVE-2017-16613: OpenStack Swauth auth bypass
    [HIGH] CVE-2017-12581: GitHub Electron RCE
    ...
  ⚠ No authentication detected
  ⚠ 1 hardcoded secret(s) detected
    github_token in env:GITHUB_PERSONAL_ACCESS_TOKEN

💰 Cost Audit
github: 22700 tokens, $0.1816 (gpt-4o)

❤️ Health Check
github: 0ms latency, 100% success

Overall Score: 75/100
```

### MCP Server (for Cline/Claude Desktop)

Add to your `cline_mcp_settings.json` or `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mcp-doctor": {
      "command": "npx",
      "args": ["@mcp-doctor/server"]
    }
  }
}
```

Then Cline/Claude can invoke these tools:

| Tool | Parameters | Description |
|------|-----------|-------------|
| `scan_security` | `configPath?` (string) | Scan MCP configs for CVEs, auth gaps, typo-squatting, and hardcoded secrets |
| `audit_costs` | `serverName?` (string) | Estimate token usage and costs per server with multi-model pricing |
| `check_health` | `serverName?` (string) | Check latency, success rate, tool count, and context pressure |
| `full_report` | `configPath?`, `format?` (json\|markdown\|text) | Generate complete audit report in chosen format |

### CI/CD Integration

Run in GitHub Actions to catch security issues before deployment:

```yaml
- name: MCP Doctor Security Scan
  run: npx mcp-doctor scan --config ./cline_mcp_settings.json
  env:
    NVD_API_KEY: ${{ secrets.NVD_API_KEY }}
```

---

## Architecture

```
mcp-doctor/
├── src/
│   ├── index.ts                    # MCP server entry (stdio transport)
│   ├── cli.ts                      # CLI wrapper (npx mcp-doctor)
│   ├── types.ts                    # 12 shared TypeScript interfaces
│   ├── config-parser.ts            # Multi-format config parsing
│   │
│   ├── services/                   # Orchestrators
│   │   ├── security-scanner.ts     # Parallel security checks + scoring
│   │   ├── cost-auditor.ts         # Token counting + pricing
│   │   └── health-monitor.ts       # Latency + reliability + DB integration
│   │
│   ├── scanners/                   # Individual security checks
│   │   ├── cve-checker.ts          # OSV.dev → NVD fallback chain
│   │   ├── auth-prober.ts          # Auth/transport detection (env + URL)
│   │   ├── typo-squat-detector.ts  # Levenshtein distance (O(n) memory)
│   │   └── secret-scanner.ts       # 6 regex patterns for secrets
│   │
│   ├── clients/                    # External API clients
│   │   ├── osv-client.ts           # api.osv.dev (purl-based)
│   │   ├── nvd-client.ts           # NIST NVD (API key + keyword search)
│   │   └── pricing-client.ts       # Cached multi-model rates
│   │
│   ├── database/
│   │   └── history-db.ts           # SQLite via sql.js (pure JS)
│   │
│   ├── reporter/
│   │   └── report-generator.ts     # Text, Markdown, JSON formatting
│   │
│   └── utils/
│       ├── token-counter.ts        # tiktoken (o200k_base) wrapper
│       ├── mcp-client.ts           # Lightweight MCP handshake probe
│       └── logger.ts              # Colored console logging
```

### Data Flow

```
User Config → ConfigParser → McpServerConfig[]
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            SecurityScanner   CostAuditor     HealthMonitor
                    │               │               │
            ┌───────┼───────┐       │               │
            ▼       ▼       ▼       ▼               ▼
        CveCheck  Auth   Secrets  Pricing     HistoryDatabase
        TypoSquat Probe  Scanner  Client      (sql.js)
            │       │       │       │               │
            └───────┴───────┴───────┴───────────────┘
                            │
                    ReportGenerator
                    (text | markdown | json)
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

Use `--config` / `configPath` to specify a custom path. MCP Doctor handles JSON files with `mcpServers`, `servers`, or flat keys.

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

Cached rates per 1M tokens (as of mid-2025):

| Model | Input ($) | Output ($) |
|-------|-----------|------------|
| GPT-4o | $5.00 | $15.00 |
| GPT-4o-mini | $0.15 | $0.60 |
| Claude 3.5 Sonnet | $3.00 | $15.00 |
| Claude 3 Haiku | $0.25 | $1.25 |
| DeepSeek Chat | $0.14 | $0.28 |
| Gemini 2.0 Flash | $0.10 | $0.40 |

Unknown models receive a conservative default estimate of $10/$30 per million tokens.

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
npm test          # Run Vitest tests

# Run locally
node dist/cli.js scan --config ./test-config.json
NVD_API_KEY=your-key node dist/cli.js report
```

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `NVD_API_KEY` | NIST NVD API key for CVE lookups (optional but recommended) |
| `MCP_DOCTOR_DB_PATH` | Override SQLite database path (default: `~/.mcp-doctor/history.db`) |
| `LOG_LEVEL` | Logging level: `DEBUG`, `INFO`, `WARN`, `ERROR` (default: `INFO`) |

---

## Roadmap

- [x] Core security, cost, and health scanning
- [x] MCP server + CLI dual entry points
- [x] NVD + OSV.dev CVE integration
- [x] SQLite history tracking
- [ ] Real MCP handshake probing (spawn + `tools/list`)
- [ ] GraphQL/SSE transport support for live servers
- [ ] Custom pricing configuration
- [ ] Alert thresholds and notifications
- [ ] Multiple config file aggregation
- [ ] Publish to npm as `@mcp-doctor/server`

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

**Built with TypeScript, @modelcontextprotocol/sdk, tiktoken, sql.js, and chalk.**