# MCP Guardian Pro — setup (buyers)

Thank you for purchasing **MCP Guardian Pro — Lifetime** ($4.99 one-time).

## What you received

| Item | Where |
|------|--------|
| **License key** | Lemon Squeezy receipt email (`{license_key}`) |
| **Control plane URL** | Fixed vendor URL below (same for all buyers — not generated per purchase) |
| **Setup guide** | This page |

Lifetime use of Pro entitlement on **self-hosted** MCP Guardian (no recurring fee).

The open-source software is also available under MIT. **npm install is free** — you are paying to unlock **Pro runtime features**, not the download.

## Enterprise mode (`GUARDIAN_ENTERPRISE_MODE=true`)

Production multi-replica deployments must set `REDIS_URL` (see [ENTERPRISE_DEPLOYMENT.md](./ENTERPRISE_DEPLOYMENT.md)). License bypass env vars (`GUARDIAN_CI_BYPASS_LICENSE`, `GUARDIAN_DEV_UNLOCK_ALL`) are **not** allowed in enterprise mode — use your `GUARDIAN_LICENSE_KEY`.

## Community vs Pro

| | Community (free) | Pro (your purchase) |
|--|------------------|---------------------|
| `npm install` | Yes | Yes |
| Proxy + policy block mode | Yes | Yes |
| CLI scan | Yes | Yes |
| Dashboard + live WebSocket | No | Yes |
| Security swarm / Analysis tab | No | Yes |
| Multi-tenant JWT binding | No | Yes |
| Semantic async audit (tier-2) | No | Yes |
| Threat Lab / Threat Discovery / Auto Threat Research | No | Yes (requires LLM — see below) |

## Install Guardian

```bash
npm install -g @mcp-guardian/server
# or clone: https://github.com/rudraneel93/mcp-guardian
```

See [README.md](../README.md) for proxy, dashboard, and policy setup.

### Guardian Autopilot (recommended)

One-command plug-and-play protection, learning, and daily digests — see [AUTOPILOT.md](./AUTOPILOT.md).

```bash
pnpm build:guardian
pnpm autopilot:init -- --apply
pnpm autopilot:start
```

If `mcp-guardian autopilot` says **unknown command**, the global npm CLI is outdated — use `pnpm autopilot:*` or `node dist/cli.js autopilot …` from this repo (see [AUTOPILOT.md](./AUTOPILOT.md)).

**Full analysis:** `pnpm analyze` or Protection → **Full analysis (plain English)**. Cost charts live under Operations → Cost only.

If the UI shows **“Dashboard API disabled; WebSocket at /ws only”**, the Pro license gate turned off REST routes. For local dev use `pnpm dashboard:proxy` (sets `GUARDIAN_CI_BYPASS_LICENSE=true`), or export it before starting the proxy:

```bash
export GUARDIAN_CI_BYPASS_LICENSE=true
export DASHBOARD_ENABLED=true
pnpm dashboard:proxy -- guardian-configs/filesystem.json
```

Open **http://localhost:4000/** (not a separate Next dev port unless you pass `?apiBase=http://localhost:4000`).

### React dashboard (required for Enterprise AI tab)

The dashboard is a light, minimalist **Next.js** static export with seven workspaces: **Protection** (default home), **Activity** (security analysis pipeline + audit), **Threats** (Threat Lab, auto research, intel), **Security** (posture, policy, AI), **Operations**, **Settings**, and **Help**.

After install or upgrade, build once before starting the dashboard:

```bash
pnpm dashboard:build
pnpm dashboard:serve   # or DASHBOARD_ENABLED=true on the proxy
```

Without `deploy/dashboard-spa/out/`, the server falls back to a legacy static shell with only basic metrics.

**MCP health report:** On Protection (home), use **Download health report** for a Markdown file (measured from `history.db`). Autopilot also writes scheduled digests — use **Generate digest now** on the Protection workspace.

Deep-link: `?workspace=activity&view=analysis`, `?workspace=threats&view=threat-lab`, `?workspace=help&topic=threat-lab` (legacy `?tab=` aliases still work).

Pipeline stages (Preflight → Technical) update in real time on **Activity → Security analysis** when you run analysis; infrastructure charts use `GET /api/visuals/live` from `history.db` (empty states when no traffic).

After upgrading, **restart the Guardian proxy** (`pnpm build` then restart) so new API routes (e.g. `/api/reports/mcp-health`, `/api/incidents/investigate`) are registered.

### Local Security Swarm (maintainer, no license key)

```bash
pnpm build
NODE_ENV=development GUARDIAN_DEV_UNLOCK_ALL=true SWARM_TOOL_WATCH=true pnpm security-swarm:fast
# or: GUARDIAN_CI_BYPASS_LICENSE=true pnpm security-swarm
```

Production / buyers: set `GUARDIAN_LICENSE_KEY` + `GUARDIAN_CONTROL_PLANE_URL` instead ([activate below](#activate-your-license)).

## LLM prerequisites

Several Pro features — **Threat Lab**, **Threat Discovery**, **Auto Threat Research**, and **semantic async audit** — call an LLM at runtime. They are designed around **local Ollama + Qwen** by default. **Neither Ollama nor model weights are installed by `npm install` or `git clone`**; you must set them up on the host yourself.

### Recommended: local Ollama + Qwen

1. **Install Ollama** on the machine running Guardian ([ollama.com](https://ollama.com/download)).
2. **Pull the default model** (not bundled with MCP Guardian):

   ```bash
   ollama pull qwen3:8b
   ```

3. **Start the Ollama server** (or use your OS service):

   ```bash
   ollama serve
   ```

4. **Enable LLM features** in your Guardian environment:

   ```bash
   export GUARDIAN_LLM_ENABLED=true
   export OLLAMA_BASE_URL=http://localhost:11434
   export GUARDIAN_LLM_MODEL=qwen3:8b   # default when provider is ollama
   export GUARDIAN_SEMANTIC_ASYNC=true  # post-hoc LLM audit on allowed tool calls (Pro)
   ```

   Semantic outcomes appear in **AI Learning → Semantic audit outcomes** and the **Infrastructure → Semantic** charts after MCP traffic flows through the wrapped proxy. Records are stored in `~/.mcp-guardian/semantic-audit-outcomes.jsonl` (default tenant).

   For Threat Lab / Threat Discovery batch runs, also set `SWARM_THREAT_LAB=true` (see [THREAT_LAB.md](THREAT_LAB.md)).

### What works without an LLM

The **dashboard**, **proxy**, **policy editor**, and **Security Swarm** shell still run without Ollama. LLM-dependent paths **skip cleanly** — Threat Lab does not emit synthetic candidates when Ollama is offline.

### Alternative: cloud LLM (Anthropic / OpenAI)

If you prefer not to run Ollama locally, set API keys and provider instead:

```bash
export GUARDIAN_LLM_ENABLED=true
export GUARDIAN_LLM_PROVIDER=anthropic   # or openai
export ANTHROPIC_API_KEY=sk-ant-...
export GUARDIAN_LLM_MODEL=claude-haiku-4-5-20251001
```

Or use another Ollama model you already have: `export GUARDIAN_LLM_MODEL=llama3.2` after `ollama pull llama3.2`.

Further detail: [THREAT_LAB.md](THREAT_LAB.md) · [AI_LEARNING.md](AI_LEARNING.md).

## Activate your license

Add to your environment (`.env`, systemd, or Kubernetes secret):

```bash
GUARDIAN_LICENSE_KEY=<your-key-from-email>
GUARDIAN_CONTROL_PLANE_URL=https://mcp-guardian-cloud.vercel.app
# Optional hard fail at startup (enterprise):
# GUARDIAN_REQUIRE_LICENSE=true
```

**`GUARDIAN_CONTROL_PLANE_URL`** is the public MCP Guardian Cloud base URL where your license is validated (`GET /api/v1/license`). It is **not** unique to your account — every Pro buyer uses the same URL. Lemon Squeezy emails only the license key; copy the control plane URL from this guide.

Restart the proxy and dashboard after setting env vars.

### Verify

```bash
curl -s -H "Authorization: Bearer YOUR-LICENSE-KEY" \
  https://mcp-guardian-cloud.vercel.app/api/v1/license | jq .
# Expect: "licensed": true
```

## Cloud control plane (optional)

Free sign-in at [mcp-guardian-cloud.vercel.app](https://mcp-guardian-cloud.vercel.app) is optional — for policy editor, API keys, and tenant env snippets. **Pro license validation does not require OAuth.**

If you prefer a **cloud org API key** (`gcp_...`) instead of the Lemon Squeezy key:

1. Sign in at [mcp-guardian-cloud.vercel.app/login](https://mcp-guardian-cloud.vercel.app/login) (Google/GitHub)
2. **Settings → Rotate API key** — copy the `gcp_...` key once
3. Set `GUARDIAN_LICENSE_KEY` to that key and keep `GUARDIAN_CONTROL_PLANE_URL=https://mcp-guardian-cloud.vercel.app`

## Support

Reply to your purchase receipt email or open a GitHub Discussion on [mcp-guardian](https://github.com/rudraneel93/mcp-guardian).

## Refunds

Per the seller’s Lemon Squeezy refund policy (typically within 14 days if the license has not been activated).
