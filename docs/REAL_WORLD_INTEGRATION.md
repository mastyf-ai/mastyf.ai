# Real-World Multi-Server MCP Integration

Mastyf AI protects multiple MCP servers through **Fleet Hub** (default) or **IDE-managed wrap** (legacy).

## Quick start — Fleet Hub (recommended)

```bash
pnpm build:mastyf-ai
mastyf-ai start
```

Fleet Hub will:

1. Discover servers from your IDE config, `~/.mastyf-ai/servers.json`, and `mastyf-ai-configs/`
2. Spawn one protected proxy per server with stable local URLs (`http://127.0.0.1:9100/mcp`, etc.)
3. Auto-patch your IDE `mcp.json` to use those URLs
4. Open the dashboard at http://localhost:4000

**Reload MCP** in your IDE once after the first start.

## Add a server from the dashboard

1. Open **MCP Fleet → Server Configuration → Add Server**
2. Fill in stdio command or remote URL (e.g. `http://localhost:3001/mcp`)
3. Copy the **local URL** shown after save
4. Reload MCP in your IDE

No empty-config hacks or manual port management required.

## Why one proxy process cannot host multiple stdio servers

Stdio MCP uses a single stdin/stdout pipe per OS process. Fleet Hub runs **one proxy child per stdio server**, each with a local HTTP ingress, so your IDE only needs URL-based entries.

## IDE-managed mode (fallback)

Use when you want the IDE to spawn wrapped stdio proxies directly:

```bash
mastyf-ai start --ide-managed
```

This auto-wraps unprotected IDE servers on first run and starts a single dashboard proxy. Best for minimal footprint or remote-SSH workflows.

## Real-life example: 4 stdio + 1 remote

Mirrors `scenarios/dogfood/` plus a remote streamable server:

| Server | Type | Fleet Hub local URL |
|--------|------|---------------------|
| github | stdio | `http://127.0.0.1:9100/mcp` |
| filesystem | stdio | `http://127.0.0.1:9101/mcp` |
| puppeteer | stdio | `http://127.0.0.1:9102/mcp` |
| postgres | stdio | `http://127.0.0.1:9103/mcp` |
| remote-api | streamable HTTP | `http://127.0.0.1:9104/mcp` |

Run the demo:

```bash
node scenarios/real-life/run-fleet-hub-demo.mjs
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `Multiple stdio MCP servers...` | Use `mastyf-ai start` (Fleet Hub), not `mastyf-ai proxy` with a multi-server config |
| IDE still uses old commands | Reload MCP; or re-run `mastyf-ai start` to re-patch |
| Fleet supervisor not running | Run `mastyf-ai start` from project root |
| Remote upstream TLS error | Set `MASTYF_AI_ALLOW_PLAINTEXT_UPSTREAM=true` or use `--unsafe-no-tls` for local dev |

## Files

| Path | Purpose |
|------|---------|
| `~/.mastyf-ai/servers.json` | UI-managed server definitions |
| `~/.mastyf-ai/fleet-state.json` | Running fleet PIDs, ports, local URLs |
| `mastyf-ai-configs/*.json` | Per-server proxy configs (auto-generated) |
| `mastyf-ai-configs/examples/fleet-manifest-remote.json` | Remote-only coordinator manifest |
