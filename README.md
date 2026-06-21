# mastyf.ai

**Know which MCP servers are safe to trust — then protect them in production.**

[mastyf.ai](https://www.mastyf.ai) is the web platform for MCP security scores, trust badges, and a free cloud console. Under the hood it runs on **[MCP Guardian](https://www.npmjs.com/package/@mastyf-ai/server)** — an open-source MCP proxy you can install from npm.

[![npm version](https://img.shields.io/npm/v/@mastyf-ai/server)](https://www.npmjs.com/package/@mastyf-ai/server)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

---

## Two products, one repo

| | **mastyf.ai** (this website) | **MCP Guardian** (npm) |
|---|---|---|
| **What it is** | Security scores, badges, cloud dashboard | Self-hosted MCP security proxy |
| **Install** | Use the hosted site or deploy `apps/cloud` | `npm install -g @mastyf-ai/server` |
| **Best for** | Look up packages, embed badges, manage policy in the cloud | Run the proxy on your own machine or in Docker/K8s |

**Simple mental model:** mastyf.ai is the public face (scores + console). MCP Guardian is the engine that scans, blocks, and audits MCP tool calls on your infrastructure.

GitHub: [github.com/mastyf-ai/mastyf.ai](https://github.com/mastyf-ai/mastyf.ai)

---

## What you can do

### On mastyf.ai (web)

- **Look up any npm MCP package** — get a 0–100 trust score and letter grade (A+ to F)
- **Embed a badge** — copy markdown/HTML for your README
- **Run a deep scan** — start the server via `npx` and probe live tools (local dev)
- **Sign in to the cloud console** — policy, fleet view, and settings (free tier)
- **Publish a maintainer score** — `mcp-guardian certify publish` from your proxy

### With MCP Guardian (CLI / proxy)

- **Scan** MCP configs for CVEs, secrets, and risky tool definitions
- **Proxy** traffic with YAML policy (block, flag, or dry-run)
- **Report** on security, cost, and health across your MCP fleet
- **Dashboard** — local SOC-style UI when the proxy is running

---

## Quick start — web (local dev)

```bash
git clone https://github.com/mastyf-ai/mastyf.ai.git
cd mastyf.ai
pnpm install

# Cloud app (landing, /certified scores, dashboard)
cp apps/cloud/.env.example apps/cloud/.env.local
# Edit .env.local — set DATABASE_URL to Postgres (local or Neon)
pnpm cloud:dev
```

Open **http://localhost:3001**

- Home + badge lookup: `/`
- Security scores: `/certified`
- Sign in: `/login` (set `AUTH_DEV_LOGIN=true` for local dev without OAuth)

More: [apps/cloud/docs/VERCEL_DEPLOY.md](apps/cloud/docs/VERCEL_DEPLOY.md) · [apps/cloud/docs/CUSTOM_DOMAIN.md](apps/cloud/docs/CUSTOM_DOMAIN.md)

---

## Quick start — MCP Guardian (npm)

```bash
npm install -g @mastyf-ai/server

# Scan all MCP servers in your config
mcp-guardian scan --all

# Proxy with policy enforcement
mcp-guardian proxy --policy ./policy.yaml --blocking-mode block

# Interactive setup
mcp-guardian onboard --apply
mcp-guardian start
```

Point your cloud console at mastyf.ai (optional):

```bash
export MASTYF_AI_CONTROL_PLANE_URL=https://www.mastyf.ai
```

---

## Trust scores & badges

1. Go to **/certified** and search a package (e.g. `@modelcontextprotocol/server-filesystem`)
2. View the score breakdown and improvement tips
3. Copy an embed snippet (GitHub, HTML, etc.)
4. Optional: **Run deep scan** for a live probe (works on localhost)
5. Maintainers: publish a signed score from the proxy:

```bash
mcp-guardian certify publish \
  --server my-server \
  --package @scope/my-mcp \
  --pkg-version 1.0.0 \
  --cloud-url https://www.mastyf.ai
```

Badge API: `GET /api/v1/badge/{package}` · Deep scan: `POST /api/v1/deep-scan/{package}`

---

## Deploy mastyf.ai to Vercel

```bash
export VERCEL_TOKEN="..."      # vercel.com/account/tokens
export DATABASE_URL="postgresql://..."   # Neon — not localhost

pnpm cloud:migrate:prod
pnpm cloud:deploy-now
```

Default URL: **https://mastyf-ai-cloud.vercel.app**  
Custom domain (`www.mastyf.ai`): see [apps/cloud/docs/CUSTOM_DOMAIN.md](apps/cloud/docs/CUSTOM_DOMAIN.md)

Verify after deploy:

```bash
APP_URL=https://mastyf-ai-cloud.vercel.app pnpm cloud:verify-prod
```

---

## How MCP Guardian works (short version)

AI clients send MCP tool calls through a **proxy**. The proxy checks each call against policy and scanners before it reaches the upstream server.

```
AI client  →  MCP Guardian proxy  →  upstream MCP server
                  │
                  ├─ Policy (YAML, hot-reload)
                  ├─ CVE / secrets / injection scans
                  ├─ Cost & health metrics
                  └─ Dashboard + alerts
```

**Detection layers:** regex patterns, schema checks, shell AST analysis, optional LLM semantic review, response DLP, and a YAML policy engine with rate limits and RBAC.

**Transports:** stdio, SSE, WebSocket, streamable HTTP, multi-tenant gateway.

**Control plane / data plane:** Node.js compiles policies; Go (`apps/proxy-core/`) can run a high-performance data plane.

---

## Repo layout (simplified)

```
mastyf.ai/
├── apps/cloud/           # Next.js site — scores, badges, cloud console
├── apps/proxy-core/      # Go data-plane proxy
├── packages/             # Shared npm packages (@mastyf-ai/core, etc.)
├── src/                  # MCP Guardian main source (proxy, scanners, agentic AI)
├── deploy/               # Docker, Helm, embedded dashboard SPA
├── security-swarm/       # Autonomous red-team agents
├── adversarial-harness/  # Attack corpus & harness
└── scripts/              # Deploy, migrate, benchmarks
```

---

## Production deployment (MCP Guardian)

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

---

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck

# Cloud app
pnpm cloud:dev
pnpm cloud:build
pnpm cloud:test

# Corpus / security swarm
pnpm eval
pnpm security-swarm:fast
```

---

## Common commands

| Command | What it does |
|---------|----------------|
| `pnpm cloud:dev` | Run mastyf.ai locally on :3001 |
| `pnpm cloud:deploy-now` | Deploy cloud app to Vercel |
| `mcp-guardian scan --all` | Scan MCP configs for issues |
| `mcp-guardian proxy --policy ./policy.yaml` | Start protected proxy |
| `mcp-guardian certify publish ...` | Publish maintainer trust score |

---

## License

MIT — see [LICENSE](LICENSE).

---

## Links

- **Website:** [mastyf.ai](https://www.mastyf.ai)
- **npm:** [@mastyf-ai/server](https://www.npmjs.com/package/@mastyf-ai/server)
- **GitHub:** [mastyf-ai/mastyf.ai](https://github.com/mastyf-ai/mastyf.ai)
- **Deploy docs:** [apps/cloud/docs/VERCEL_DEPLOY.md](apps/cloud/docs/VERCEL_DEPLOY.md)
