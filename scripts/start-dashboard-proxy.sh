#!/usr/bin/env sh
# Start MCP Mastyf AI proxy with dashboard SPA + live metrics from MASTYF_AI_DB_PATH.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -f dist/cli.js ]; then
  echo "[dashboard-proxy] Building dist…" >&2
  pnpm build
elif [ ! -f dist/utils/dashboard-server.js ] \
  || [ src/utils/dashboard-server.ts -nt dist/utils/dashboard-server.js ] \
  || [ src/utils/swarm-session.ts -nt dist/utils/swarm-session.js 2>/dev/null ] \
  || [ src/utils/swarm-artifacts.ts -nt dist/utils/swarm-artifacts.js 2>/dev/null ] \
  || [ src/utils/threat-discovery-status.ts -nt dist/utils/threat-discovery-status.js 2>/dev/null ] \
  || [ ! -f dist/ai/mcp-health-report.js ] \
  || [ src/ai/mcp-health-report.ts -nt dist/ai/mcp-health-report.js 2>/dev/null ] \
  || [ src/ai/mastyf-ai-full-analysis.ts -nt dist/ai/mastyf-ai-full-analysis.js 2>/dev/null ]; then
  echo "[dashboard-proxy] Rebuilding dist (dashboard API changed)…" >&2
  pnpm exec tsc --project tsconfig.json
fi

if [ ! -f deploy/dashboard-spa/out/index.html ]; then
  echo "[dashboard-proxy] Building dashboard SPA…" >&2
  SPA="deploy/dashboard-spa"
  if [ -f scripts/build-dashboard-spa.sh ]; then
    sh scripts/build-dashboard-spa.sh
  elif [ -x "$SPA/node_modules/.bin/next" ]; then
    (cd "$SPA" && npm run build)
  else
    echo "[dashboard-proxy] Installing dashboard deps (npm)…" >&2
    (cd "$SPA" && npm install && npm run build)
  fi
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
#   MASTYF_AI_DB_PATH="$PWD/reports/local-history.db" ./scripts/start-dashboard-proxy.sh
export MASTYF_AI_DB_PATH="${MASTYF_AI_DB_PATH:-$HOME/.mastyf-ai/history.db}"
export DASHBOARD_ENABLED=true
export DASHBOARD_AUTH_DISABLED="${DASHBOARD_AUTH_DISABLED:-true}"
export MASTYF_AI_WS_ENABLED="${MASTYF_AI_WS_ENABLED:-true}"
export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
# Local dev: enable dashboard REST API (set DASHBOARD_ENABLED=true)
export MASTYF_AI_CI_BYPASS_LICENSE="${MASTYF_AI_CI_BYPASS_LICENSE:-true}"
export MASTYF_AI_LLM_ENABLED="${MASTYF_AI_LLM_ENABLED:-true}"
export MASTYF_AI_SEMANTIC_ASYNC="${MASTYF_AI_SEMANTIC_ASYNC:-true}"
export MASTYF_AI_AI_ENABLED="${MASTYF_AI_AI_ENABLED:-true}"
export MASTYF_AI_LEARNING_WARMUP="${MASTYF_AI_LEARNING_WARMUP:-true}"
export MASTYF_AI_CORPUS_REPLAY_POLICY_PATH="${MASTYF_AI_CORPUS_REPLAY_POLICY_PATH:-default-policy.yaml}"
export MASTYF_AI_THREAT_RESEARCH_AUTO="${MASTYF_AI_THREAT_RESEARCH_AUTO:-true}"
export SWARM_THREAT_RESEARCH_AUTO="${SWARM_THREAT_RESEARCH_AUTO:-true}"
export MASTYF_AI_THREAT_RESEARCH_REQUIRE_REPLAY="${MASTYF_AI_THREAT_RESEARCH_REQUIRE_REPLAY:-false}"
export MASTYF_AI_HOME="${MASTYF_AI_HOME:-$PWD/reports/home}"
# Shared vuln store for fleet children (findings / live-stats / disclosure packages)
export MASTYF_AI_VULN_STORE_DIR="${MASTYF_AI_VULN_STORE_DIR:-$MASTYF_AI_HOME}"
# When VDE is on, enable live novel tap unless explicitly disabled
if [ "${MASTYF_AI_VULN_DISCOVERY_ENABLED:-}" = "true" ] \
  && [ "${MASTYF_AI_VULN_LIVE_TAP:-}" != "false" ]; then
  export MASTYF_AI_VULN_LIVE_TAP=true
fi
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
  join(root, 'mastyf-ai-configs', 'filesystem.json'),
  ...(() => {
    const dir = join(root, 'mastyf-ai-configs');
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

if [ -z "$CONFIG" ] && [ "${MASTYF_AI_FLEET_MODE:-true}" != "true" ]; then
  if CONFIG=$(pick_single_server_config 2>/dev/null); then
    :
  else
    echo "[dashboard-proxy] No single-server MCP config found." >&2
    echo "  Pass a config path: pnpm dashboard:proxy -- mastyf-ai-configs/filesystem.json" >&2
    echo "  Or use Fleet Hub (default): MASTYF_AI_FLEET_MODE=true ./scripts/start-dashboard-proxy.sh" >&2
    echo "  See docs/REAL_WORLD_INTEGRATION.md" >&2
    exit 1
  fi
fi

BLOCKING="${MASTYF_AI_BLOCKING_MODE:-block}"

echo "[dashboard-proxy] DB: $MASTYF_AI_DB_PATH" >&2
echo "[dashboard-proxy] Dashboard: http://localhost:${DASHBOARD_PORT}/" >&2
echo "[dashboard-proxy] Config: $CONFIG  Policy: $POLICY  Mode: $BLOCKING" >&2
echo "[dashboard-proxy] Corpus replay policy: $MASTYF_AI_CORPUS_REPLAY_POLICY_PATH" >&2

if command -v curl >/dev/null 2>&1; then
  if ! curl -sf "${OLLAMA_BASE_URL}/api/tags" >/dev/null 2>&1; then
    echo "[dashboard-proxy] WARNING: Ollama not reachable at $OLLAMA_BASE_URL — Auto Threat Research and semantic features need a running LLM (ollama serve)." >&2
  fi
fi

# Fleet Hub (default): one supervisor protects all discovered MCP servers.
# Set MASTYF_AI_FLEET_MODE=false to use legacy single-proxy mode.
if [ "${MASTYF_AI_FLEET_MODE:-true}" = "true" ]; then
  echo "[dashboard-proxy] Starting Fleet Hub (mastyf-ai start)…" >&2
  exec node dist/cli.js start --policy "$POLICY" --blocking-mode "$BLOCKING"
fi

exec node dist/cli.js proxy --config "$CONFIG" --policy "$POLICY" --blocking-mode "$BLOCKING"
