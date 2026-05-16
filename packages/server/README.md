# @mcp-guardian/server

Security proxy for Model Context Protocol (MCP) — protects AI agents from prompt injection, data exfiltration, tool misuse, and supply-chain attacks.

## Features

- **Policy Enforcement** — Block, flag, or audit every `tools/call` against configurable YAML rules
- **Prompt Injection Detection** — Multi-layer scanning (regex, schema, semantic LLM)
- **Rug-pull Detection** — Fingerprints `tools/list` responses to detect mid-session tool mutations
- **CVE Scanning** — OSV.dev + NVD with transitive dependency analysis
- **Secret Scanning** — 30+ patterns with entropy gating
- **Command Validation** — AST-based shell injection detection with Unicode normalization
- **Token Counting** — Per-provider tokenizers (tiktoken, Anthropic API, litellm)
- **Circuit Breaker** — 3-state pattern protects upstream MCP servers
- **Hot Reload** — Policy changes take effect in under 300ms
- **Prometheus Metrics** — Latency, blocked requests, circuit breaker state
- **Structured Logging** — Pino-based JSON logging with PostgreSQL shipping

## Installation

```bash
npm install -g @mcp-guardian/server
```

## Quick Start

```bash
# Scan your MCP config for vulnerabilities
mcp-guardian scan --config mcp.json

# Proxy mode: protect all tool calls
mcp-guardian proxy --config mcp.json --policy default-policy.yaml --blocking-mode block

# Audit mode: log only, no blocking
mcp-guardian proxy --config mcp.json --policy default-policy.yaml --blocking-mode audit
```

## CLI Commands

```
mcp-guardian proxy        Start the security proxy
mcp-guardian scan         Security scan on MCP configuration
mcp-guardian audit        Token usage and cost audit
mcp-guardian health       Health check for MCP servers
mcp-guardian full-report  Comprehensive security + cost report
```

## License

MIT