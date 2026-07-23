# Mastyf.ai — AI Agent Security Proxy

Mastyf.ai protects AI agents from prompt injection, data exfiltration, and tool misuse.
It sits between any MCP-compatible AI agent and its tools, deciding in real time whether
to allow, block, or audit every action.

## Quick Start

```bash
git clone https://github.com/mastyf-ai/mastyf.ai.git && cd mastyf.ai
pnpm install && pnpm build
node dist/cli.js start
```
Dashboard: **http://localhost:4000**

## How It Works

Every tool call from your AI agent passes through a 4-layer detection engine:
1. **Regex patterns** — 37 rules for shell injection, path traversal, SSRF, encoding evasion
2. **Schema validation** — JSON Schema checks for malformed payloads and schema injection
3. **LLM semantic scan** — qwen3:8b reads intent and classifies prompt injection attacks
4. **Argument scanner** — 456 context-aware patterns (SQL checks on `query`, SSRF on `url`)

22 enforcement strategies run in sequence: user identity, rate limiting, token budgets,
threat intel, encoding guards, tool denial, and a YAML policy engine. First block wins.

## Core Features

### Detection & Enforcement
- **Policy engine** — Write YAML rules, hot-reload without restart
- **Per-user rules** — Alice can read /home/* but not /etc/*. CI bot gets 30 calls/minute
- **Rate limiting** — 40 calls/10s, 120 calls/min per tool per user
- **Token budgets** — Cap tokens per call to prevent runaway agents

### Identity & SSO
- **OIDC federation** — Okta, Auth0, Entra ID, Clerk, Keycloak
- **SAML 2.0** — Enterprise identity provider support
- **Credential broker** — AES-256-GCM encrypted tokens, injected into upstream requests, stripped from responses. The LLM never sees real credentials
- **Per-role enforcement** — Define policies by role ("all developers can read /home/*")

### Hooks
- **9 built-in hooks** — Rate limiter, PII redaction, path guard, Slack notifier, PagerDuty, time-based access, geo-fencing, custom JS
- **Custom hooks** — Write JavaScript from the dashboard, no restart needed
- **Pre/post/error hooks** — Run before tool execution, after response, or on error

### Security Testing
- **Eval playground** — 34 attack payloads across 11 categories. Run all and see accuracy
- **Corpus auto-growth** — Blocked production calls become eval entries. High-confidence auto-verify, low-confidence queue for review
- **Corpus review panel** — Approve/reject pending entries. Run tribunal for auto-analysis
- **Security swarm** — Autonomous red-team testing
- **Protocol fuzzer** — 15 MCP protocol attack payloads
- **Learning mode** — Observes allowed traffic, suggests whitelist rules

### Fleet Management
- **Auto-wrapping** — Drop a config in ~/.mastyf-ai/servers.json, the Fleet Hub wraps it
- **Cloud control plane** — Centralized policy, fleet heartbeat, audit aggregation
- **Team management** — Per-team policies, license tiering

### Dashboard
- **11 workspaces** — Executive, Activity, Security, Policy, Cost, Servers, Compliance, AI Ops, Settings, Logs, Help
- **Real-time WebSocket** — Live updates at 5s intervals
- **Embeddable widgets** — /widgets page for external dashboards

## Configuration

### Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `DASHBOARD_PORT` | Dashboard port | 4000 |
| `DASHBOARD_AUTH_DISABLED` | Disable auth (dev only) | false |
| `OLLAMA_BASE_URL` | Ollama endpoint | http://localhost:11434 |
| `MASTYF_AI_LLM_ENABLED` | Enable LLM scanning | false |
| `MASTYF_AI_LLM_MODEL` | LLM model name | qwen3:8b |
| `MASTYF_AI_LLM_PROVIDER` | Provider (ollama/anthropic/openai) | ollama |
| `OLLAMA_ENABLED` | Force Ollama mode | false |
| `MASTYF_AI_SEMANTIC_TIMEOUT_MS` | Semantic scan timeout | 500 |
| `MASTYF_AI_DB_ENCRYPTION_KEY` | AES-256-GCM key for field encryption | none |
| `MASTYF_AI_CONTROL_PLANE_URL` | Cloud control plane URL | none |
| `MASTYF_AI_CLOUD_API_KEY` | Cloud API key | none |
| `MASTYF_AI_SLACK_WEBHOOK` | Slack notification webhook | none |
| `ALERT_PAGERDUTY_KEY` | PagerDuty routing key | none |
| `MASTYF_AI_ALLOWED_REGIONS` | Geo-fencing regions | none |
| `MASTYF_AI_ACCESS_HOURS` | Allowed access hours (e.g., 8-18) | none |

### Policy YAML Example

```yaml
policy:
  mode: block
  rules:
    - name: block-dangerous-tools
      tools:
        deny: [execute_command, bash, sh, eval, curl]
    - name: block-sensitive-paths
      argPatterns:
        path: [/etc/*, .env, .ssh/*, .aws/*, *.pem, *.key]
    - name: rate-limit
      maxCallsPerMinute: 60
```

## Docker

```bash
docker run --rm -d --name mastyf \
  -p 4000:4000 \
  -v $(pwd)/default-policy.yaml:/app/default-policy.yaml \
  -v $(pwd)/mastyf-ai-configs:/app/mastyf-ai-configs \
  -e DASHBOARD_AUTH_DISABLED=true \
  -e OLLAMA_BASE_URL=http://host.docker.internal:11434 \
  --add-host host.docker.internal:host-gateway \
  mastyf-ai:latest
```

## API Reference

### SSO Federation
- `GET /api/auth/sso/providers` — List enabled IdPs
- `GET /api/auth/sso/login/:id` — Initiate OIDC/SAML login
- `GET /api/auth/sso/callback/:id` — Handle callback
- `GET/POST/PUT/DELETE /api/auth/sso/settings` — Manage IdP configs

### Policy
- `GET/PUT /api/policy` — Read/write policy YAML
- `PATCH/DELETE /api/policy/rules` — Per-rule operations
- `POST /api/policy/test` — Test policy against payload

### Eval & Corpus
- `GET /api/eval/payloads` — List test payloads (static + dynamic)
- `POST /api/eval/run` — Run eval against policy engine
- `GET /api/eval/unverified` — List pending review entries
- `POST /api/eval/verify` — Verify/reject/tribunal

### Hooks
- `GET /api/hooks` — List all registered hooks
- `POST /api/hooks` — Register custom hook (JS code)

### Credentials
- `GET /api/credentials` — List stored credentials
- `POST /api/credentials` — Store new credential

### Learning & Audit
- `GET /api/learning/suggestions` — Learning mode suggestions
- `GET /api/audit/verify` — Audit chain integrity check
- `GET /api/learning/semantic/tribunal` — Tribunal status
- `POST /api/learning/semantic/tribunal/run` — Start tribunal batch

### Fleet & Health
- `GET /health` — Proxy health (ready status, uptime, PID)
- `GET /api/instances` — Fleet instances
- `GET /api/servers/registry` — Server registry

### Cloud Control Plane
- `GET /api/v1/control?action=policy` — Poll latest policy version
- `POST /api/v1/control` (heartbeat) — Register proxy instance
- `POST /api/v1/control` (audit-push) — Push audit aggregates
- `POST /api/v1/control` (publish-policy) — Publish new policy version
- `GET /api/v1/license/manage` — License tier
- `GET /api/v1/threat-feed` — Community threat feed
- `GET /api/v1/trust-scores` — Package trust scores
- `GET/POST /api/v1/teams` — Team management

## Architecture

```
AI Agent (Cursor/Claude/Copilot)
        │
        ▼
┌─────────────────┐
│  Mastyf Proxy   │ ← 4-layer detection + 22 strategies
│  (localhost:4000)│
└────┬────────────┘
     │ block / allow / audit
     ▼
MCP Servers (filesystem, GitHub, DB, etc.)

            ┌──────────────────┐
            │ Cloud Dashboard  │ ← policy mgmt, fleet, audit
            │ (localhost:3001) │
            └──────────────────┘
```

Data stays local. Cloud only receives anonymized counts.
