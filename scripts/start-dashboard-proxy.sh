#!/usr/bin/env sh
# Start MCP Guardian proxy with dashboard SPA + live metrics from MCP_GUARDIAN_DB_PATH.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -f dist/cli.js ]; then
  echo "[dashboard-proxy] Building dist…" >&2
  pnpm build
elif [ ! -f dist/utils/dashboard-server.js ] \
  || [ src/utils/dashboard-server.ts -nt dist/utils/dashboard-server.js ] \
  || [ ! -f dist/ai/mcp-health-report.js ] \
  || [ src/ai/mcp-health-report.ts -nt dist/ai/mcp-health-report.js 2>/dev/null ] \
  || [ src/ai/guardian-full-analysis.ts -nt dist/ai/guardian-full-analysis.js 2>/dev/null ]; then
  echo "[dashboard-proxy] Rebuilding dist (dashboard API changed)…" >&2
  pnpm exec tsc --project tsconfig.json
fi

if [ ! -f deploy/dashboard-spa/out/index.html ]; then
  echo "[dashboard-proxy] Building dashboard SPA…" >&2
  pnpm dashboard:build
fi

# Stop standalone dashboard:serve if it holds :4000
if command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -ti :"${DASHBOARD_PORT:-4000}" 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "[dashboard-proxy] Stopping process(es) on port ${DASHBOARD_PORT:-4000}: $PIDS" >&2
    kill $PIDS 2>/dev/null || true
    sleep 1
  fi
fi

# Proxy and dashboard read the same history DB — set explicitly when using a repo-local DB:
#   MCP_GUARDIAN_DB_PATH="$PWD/reports/local-history.db" ./scripts/start-dashboard-proxy.sh
export MCP_GUARDIAN_DB_PATH="${MCP_GUARDIAN_DB_PATH:-$HOME/.mcp-guardian/history.db}"
export DASHBOARD_ENABLED=true
export DASHBOARD_AUTH_DISABLED="${DASHBOARD_AUTH_DISABLED:-true}"
export GUARDIAN_WS_ENABLED="${GUARDIAN_WS_ENABLED:-true}"
export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
# Local dev: enable dashboard REST API without Pro license (see CHANGELOG / docs/PRO_SETUP.md)
export GUARDIAN_CI_BYPASS_LICENSE="${GUARDIAN_CI_BYPASS_LICENSE:-true}"
export GUARDIAN_LLM_ENABLED="${GUARDIAN_LLM_ENABLED:-true}"
export GUARDIAN_CORPUS_REPLAY_POLICY_PATH="${GUARDIAN_CORPUS_REPLAY_POLICY_PATH:-default-policy.yaml}"
export GUARDIAN_THREAT_RESEARCH_AUTO="${GUARDIAN_THREAT_RESEARCH_AUTO:-true}"
export SWARM_THREAT_RESEARCH_AUTO="${SWARM_THREAT_RESEARCH_AUTO:-true}"
export GUARDIAN_THREAT_RESEARCH_REQUIRE_REPLAY="${GUARDIAN_THREAT_RESEARCH_REQUIRE_REPLAY:-false}"
export MCP_GUARDIAN_HOME="${MCP_GUARDIAN_HOME:-$PWD/reports/home}"
export METRICS_ENABLED="${METRICS_ENABLED:-true}"
export DASHBOARD_PORT="${DASHBOARD_PORT:-4000}"
export METRICS_PORT="${METRICS_PORT:-9090}"

CONFIG="${1:-}"
POLICY="${2:-default-policy.yaml}"

pick_single_server_config() {
  node <<'NODE'
const { readdirSync, readFileSync, existsSync } = require('fs');
const { join } = require('path');
const root = process.cwd();
const candidates = [
  join(root, 'guardian-configs', 'filesystem.json'),
  ...(() => {
    const dir = join(root, 'guardian-configs');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => join(dir, f));
  })(),
];
const seen = new Set();
for (const p of candidates) {
  if (seen.has(p) || !existsSync(p)) continue;
  seen.add(p);
  try {
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    const servers = Object.values(cfg.mcpServers || cfg.servers || {});
    const stdioCount = servers.filter((s) => s && (s.command || s.transport === 'stdio')).length;
    if (stdioCount === 1) {
      process.stdout.write(p.replace(root + '/', ''));
      process.exit(0);
    }
  } catch {
    /* try next */
  }
}
process.exit(1);
NODE
}

if [ -z "$CONFIG" ]; then
  if CONFIG=$(pick_single_server_config 2>/dev/null); then
    :
  else
    echo "[dashboard-proxy] No single-server MCP config found." >&2
    echo "  Pass a config path: pnpm dashboard:proxy -- guardian-configs/filesystem.json" >&2
    echo "  Multi-server configs (e.g. scenarios/real-life/mcp-config.json) need one proxy per server — see docs/REAL_WORLD_INTEGRATION.md" >&2
    exit 1
  fi
fi

BLOCKING="${GUARDIAN_BLOCKING_MODE:-block}"

echo "[dashboard-proxy] DB: $MCP_GUARDIAN_DB_PATH" >&2
echo "[dashboard-proxy] Dashboard: http://localhost:${DASHBOARD_PORT}/" >&2
echo "[dashboard-proxy] Config: $CONFIG  Policy: $POLICY  Mode: $BLOCKING" >&2
echo "[dashboard-proxy] Corpus replay policy: $GUARDIAN_CORPUS_REPLAY_POLICY_PATH" >&2

if command -v curl >/dev/null 2>&1; then
  if ! curl -sf "${OLLAMA_BASE_URL}/api/tags" >/dev/null 2>&1; then
    echo "[dashboard-proxy] WARNING: Ollama not reachable at $OLLAMA_BASE_URL — Auto Threat Research and semantic features need a running LLM (ollama serve)." >&2
  fi
fi

exec node dist/cli.js proxy --config "$CONFIG" --policy "$POLICY" --blocking-mode "$BLOCKING"
