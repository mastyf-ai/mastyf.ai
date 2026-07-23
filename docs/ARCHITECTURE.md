# Mastyf.ai Architecture

## Split-Plane Model

```
┌─────────────────────────────────────────────────────────┐
│  AI Agent (Cursor/Claude/Copilot)                       │
└──────────────────────┬──────────────────────────────────┘
                       │ MCP JSON-RPC 2.0
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Mastyf Proxy (localhost:4000)                           │
│  ┌───────────────────────────────────────────────────┐  │
│  │  4-Layer Detection Engine                          │  │
│  │  L1: Regex (37 patterns)                           │  │
│  │  L2: Schema (Ajv JSON Schema)                      │  │
│  │  L3: LLM Semantic (qwen3:8b via Ollama)            │  │
│  │  L4: Runtime Argument (456 context-aware patterns) │  │
│  ├───────────────────────────────────────────────────┤  │
│  │  22 Policy Strategies                              │  │
│  │  Identity → Rate Limit → Token Budget → Threat     │  │
│  │  Intel → Encoding Guard → Tool Deny → YAML Rules  │  │
│  ├───────────────────────────────────────────────────┤  │
│  │  9 Hooks Pipeline                                  │  │
│  │  Before → Policy → After → Error                   │  │
│  ├───────────────────────────────────────────────────┤  │
│  │  Credential Broker (AES-256-GCM encrypted)         │  │
│  ├───────────────────────────────────────────────────┤  │
│  │  Audit Hash Chain (SHA-256)                        │  │
│  └───────────────────────┬───────────────────────────┘  │
│                          │                                │
│                    allow / block / audit                  │
│                          ▼                                │
│               MCP Servers (filesystem, DB, API)          │
└─────────────────────────────────────────────────────────┘

                            │
                            │ anonymized counts (no raw data)
                            ▼
┌─────────────────────────────────────────────────────────┐
│  Cloud Control Plane (localhost:3001)                    │
│  ┌───────────────────┐  ┌─────────────────────────────┐ │
│  │ Fleet Management  │  │ Community Services           │ │
│  │ • Heartbeat       │  │ • Threat Feed (MTX format)   │ │
│  │ • Policy Push     │  │ • Trust Scores (A+-F)       │ │
│  │ • Audit Aggregate │  │ • Benchmarks                 │ │
│  └───────────────────┘  └─────────────────────────────┘ │
│  PostgreSQL · NextAuth · Drizzle ORM · Vercel           │
└─────────────────────────────────────────────────────────┘
```

## Data Flow

1. Agent sends MCP JSON-RPC request → intercepted by Fleet Hub
2. Fleet Hub forwards to child proxy process on assigned port (9100-9114)
3. Proxy runs 4-layer detection + 22 strategies + hooks
4. Decision logged to SQLite with SHA-256 hash chain
5. If allowed: forwarded to upstream MCP server, credentials injected, response stripped
6. If blocked: error returned, corpus entry created, audit chain appended
7. Every 30s: policy polled from cloud, hot-reloaded if new version
8. Every 60s: anonymized audit snapshot pushed to cloud

## Directory Structure

```
src/                  # Core TypeScript (555 files)
  proxy/              # MCP transport interceptors (37 files)
  policy/             # Policy engine + strategies (60 files)
  auth/               # OIDC/SAML/SSO + RBAC (27 files)
  ai/                 # AI learning + tribunal + swarm
  agentic/            # Trust scores + RL agents (90 files)
  utils/              # Dashboard, metrics, persistence
  database/           # SQLite + PostgreSQL adapters
  fleet/              # Fleet supervisor

packages/             # Monorepo libraries (128 files)
  core/               # Detection engine (regex + schema + semantic)
  server/             # MCP scan server
  cli/                # CLI binary
  plugin-sdk/         # Public detector plugin SDK
  mtx/                # MCP Threat Exchange format
  langchain-middleware/ # LangChain integration
  openai-agents-middleware/ # OpenAI Agents SDK
  tool-registry/      # Trust score scanner

apps/                 # Applications
  cloud/              # Next.js SaaS control plane (170 files)

deploy/
  dashboard-spa/      # Next.js proxy dashboard (173 files)
  widgets/            # Embeddable widget library
  helm/               # Kubernetes Helm charts
  Dockerfile          # Multi-stage Docker build
```
