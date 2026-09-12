# Dashboard canonical runbook (Mastyf Perimeter)

**Product:** Mastyf — trusted security layer between AI and MCP (execution perimeter / reference monitor), not a SIEM.  
**Default UI:** Shield → Security Center (Security Posture) → Engineering Console.  
**Three projections of one OS:** `shield` | `security-center` | `advanced` (Engineering Console).  
**Settings / Legacy:** History lab (`history-db`) and Expert Console workspaces live behind Engineering Console **Legacy** fold only.

## Two processes (both required)

| Process | Port | Command |
|---------|------|---------|
| Python control plane | **8443** | `cd mastyf_gateway && python3 -m mastyf_gateway.cli serve --port 8443` |
| Node proxy + BFF | **4000** | `pnpm dashboard:proxy` (or local `tsx … proxy` with `DASHBOARD_ENABLED=true`) |

### Preferred: one-command stack

```bash
chmod +x scripts/dev-perimeter-stack.sh
./scripts/dev-perimeter-stack.sh restart all   # start + probe
./scripts/dev-perimeter-stack.sh probe         # exit 1 if routes missing
./scripts/dev-perimeter-stack.sh status
```

Probes (must not 404 — 404 = **stale BFF** that never loaded current `gateway-routes.ts`):

- `GET http://127.0.0.1:4000/health`
- `GET http://127.0.0.1:4000/api/gateway/runtime-health`
- `GET http://127.0.0.1:4000/api/gateway/operator-grants`
- `GET http://127.0.0.1:4000/api/gateway/alerting-status`
- `GET http://127.0.0.1:8443/healthz`

`pnpm dashboard:proxy` / `scripts/start-dashboard-proxy.sh` rebuilds `dist/` when `src/dashboard/gateway-routes.ts` is newer than `dist/dashboard/gateway-routes.js`. **Always restart BFF after editing gateway routes.** Stack doctor in the appliance UI runs the same probe set.

Decide / protect / escalate call **8443** through the Node BFF on **4000**.  
If Node is restarted with new code but Python is stale, `/api/gateway/decide` returns `Gateway error (404): Not Found` — **restart Python serve**.  
If Python is current but Node is stale, `/api/gateway/bff-info` or decide returns `Gateway API route not found` — **restart Node**.

### Observability (optional LGTM)

```bash
docker compose -f deploy/observability/docker-compose.obs.yml up -d
```

See [`deploy/observability/README.md`](../deploy/observability/README.md) and [`docs/OBSERVABILITY_IMPLEMENTATION_PLAN.md`](./OBSERVABILITY_IMPLEMENTATION_PLAN.md).

### Watchdog (durable BFF)

When Next (`:3000`) rewrites `/api/*` to the BFF, a crashed proxy leaves the appliance OFFLINE with non-JSON / HTML errors. Prefer the restart loop:

```bash
chmod +x scripts/watch-dashboard-proxy.sh
./scripts/watch-dashboard-proxy.sh
# optional config arg:
# ./scripts/watch-dashboard-proxy.sh mastyf-ai-configs/filesystem.json
```

- Restarts `scripts/start-dashboard-proxy.sh` on exit with exponential backoff (2s → 30s).
- Unified stack probe: `GET /api/gateway/runtime-health` (BFF · Gateway `/healthz` · Guard intelligence).
- Chaos accept: kill BFF → UI shows clear BFF hint; restore → LIVE / stack honest.

### Node version pin

`better-sqlite3` must match the Node ABI used to install deps. Prefer **Node 20 LTS** (CI) or a local nvm Node that matches your install (e.g. 23). Homebrew Node tip majors often break native modules.

### Canonical Node start

```bash
export MASTYF_AI_DB_PATH="$HOME/.mastyf-ai/history.db"
pnpm dashboard:proxy
```

Fleet / multi-server local proxy often needs:

```bash
export MASTYF_AI_FLEET_CHILD=true
# then your proxy command, or use Fleet Hub via dashboard:proxy default
```

### Dev SPA (`next dev`)

[`deploy/dashboard-spa/next.config.ts`](../deploy/dashboard-spa/next.config.ts) rewrites `/api/*` → `localhost:${SOC_API_PORT|MASTYF_AI_PORT|4000}`.

Point that port at the process that mounts `handleGatewayApiRoutes`.

## Golden path smoke

```bash
pnpm dashboard:smoke-golden
# or: bash scripts/smoke-dashboard-golden-path.sh
pnpm dashboard:check-no-mocks
```

Must pass before shipping Perimeter changes. Manual UI walk:

1. **Shield:** PROTECTED + live receipt counts (`data-source=live`)  
2. **Protection → Decide probe:** labeled DRY-RUN → real `final_decision`  
3. **Activity:** receipt row → drawer keyed by `receipt_id`  
4. Drawer: Allow once → control receipt ID in toast  
5. **Compliance / Evidence:** evidence pack via `GET /api/gateway/evidence-pack` + control receipts  
6. Banner: GATEWAY + BFF OK + DB fingerprint  
7. **Ops Lab / Harden:** from-receipt candidate; accept requires human + corpus replay; never auto-applies policy  

Deep links (appliance): see [`deploy/dashboard-spa/lib/deep-links.ts`](../deploy/dashboard-spa/lib/deep-links.ts) — `mode` / `tab` / `band` / `receipt_id`.

| Link | Purpose |
|------|---------|
| `?mode=shield` | Shield home |
| `?mode=security-center&tab=home` | Security Posture |
| `?mode=security-center&tab=activity` | Activity timeline |
| `?mode=security-center&tab=activity&receipt_id=<id>` | Activity + ActionTrace drawer |
| `?mode=security-center&tab=ops-lab&receipt_id=<id>` | Ops Lab forensic narrative |
| `?mode=security-center&tab=access` | AI Access |
| `?mode=security-center&tab=ask` | Ask Mastyf |
| `?mode=security-center&tab=protection` | Protection / Guard V6 |
| `?mode=security-center&tab=trust-graph` | Trust Graph |
| `?mode=security-center&tab=compliance` | Continuous Security Evidence |
| `?workspace=compliance` | Alias → Security Center compliance |
| `?mode=advanced` | Engineering Console (Control / Evidence / Engineering) |
| `?mode=advanced&receipt_id=<id>&band=evidence` | Engineering Evidence + forensic |

Legacy Focus/Stream surfaces: `?surface=focus|stream|agents|rules|proof|harden` (aliases only).

## OS6 ecosystem (Verified / profile / fleet)

| Surface | Notes |
|---------|-------|
| `schemas/mcp-security.yaml` | Portable `mastyf_security_profile` — protect loads via `MASTYF_SECURITY_PROFILE` or cwd/`~/.mastyf` |
| `GET /v1/security-profile` | Profile load status (LOADED / ABSENT / INVALID) |
| `POST /v1/verified/check` | Signed Verified manifest → **profile states** only; keys missing → `UNAVAILABLE` (no score) |
| Fleet mutate | `X-Mastyf-Role` on protect apply / rollback / policy activate; optional `MASTYF_FLEET_RBAC_REQUIRED=true` |
| Middleware | LangChain / OpenAI Agents emit `mastyf_action_receipt` (same shape as `src/security-os/action-receipt.ts`) |

## Data honesty

| Source | Used for |
|--------|----------|
| `live-gateway` | Shield / Home KPIs, receipts, protect, decide, escalate, evidence pack |
| `history-db` | History lab only (Cost / Fleet history / Logs) — Legacy fold |
| `unavailable` | Empty — never invent numbers |
| `live\|harness` | Harden / decide dry-run — never as Shield/Home KPIs |

### Demo ledger (do not rewrite the hash chain)

Probe ids (`slo-e2e-*`, `node-e2e-lat-*`, `obs-prom-*`, `pw_shield*`, `allow_once_next_*`) stay in `~/.mastyf/receipts.jsonl` and show a **HARNESS** pill. Window KPIs (`/v1/receipts/window-stats`) exclude those ids and report `harness_excluded` — they never invent a customer zero from an empty customer window.

For a customer demo, start a **new** ledger instead of deleting lines:

```bash
pnpm dashboard:demo-ledger
# then restart the Python gateway with the printed MASTYF_HOME
```

Gateway writes `$MASTYF_HOME/receipts.jsonl`. Never splice or rewrite an existing chain to “clean” it.

## Perimeter IA

| Surface | Operator question |
|---------|-------------------|
| Shield | Am I protected? |
| Security Center Home | Security posture — coverage, attention, exposure |
| Activity | What just happened? |
| AI Access | What can AI touch? |
| Protection / Policy | What is allowed? |
| Compliance | Can I prove it? |
| Ops Lab / Harden | What should we harden? (human + replay only) |
| Engineering Console | How exactly — raw proof |

History lab and Legacy Expert Console must never contradict live ledger KPIs on Shield/Home.
