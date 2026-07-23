#!/bin/sh
set -e

# ── Mastyf AI Docker Entrypoint ────────────────────────────────────────────
# Supports both single-container and multi-service deployments.
# Requires Redis when REDIS_URL is set; falls back to in-memory otherwise.

mkdir -p /data 2>/dev/null || true

# ── Default config/policy discovery ───────────────────────────────────────
if [ -z "$MASTYF_AI_CONFIG_PATH" ] && [ -f /etc/mastyf-ai/mcp.json ]; then
  export MASTYF_AI_CONFIG_PATH=/etc/mastyf-ai/mcp.json
fi
if [ -z "$MASTYF_AI_POLICY_PATH" ] && [ -f /etc/mastyf-ai/policy.yaml ]; then
  export MASTYF_AI_POLICY_PATH=/etc/mastyf-ai/policy.yaml
fi

# ── Wait for Redis if configured ──────────────────────────────────────────
if [ -n "$REDIS_URL" ]; then
  echo "[entrypoint] Waiting for Redis at $REDIS_URL ..."
  REDIS_HOST=$(echo "$REDIS_URL" | sed -n 's|.*@\?\([^:/]*\).*|\1|p')
  REDIS_PORT=$(echo "$REDIS_URL" | sed -n 's|.*:\([0-9]*\)[^0-9]*$|\1|p')
  REDIS_PORT=${REDIS_PORT:-6379}
  for i in $(seq 1 60); do
    if nc -z "$REDIS_HOST" "$REDIS_PORT" 2>/dev/null; then
      echo "[entrypoint] Redis is ready"
      break
    fi
    if [ "$i" -eq 60 ]; then
      echo "[entrypoint] WARNING: Redis not reachable — starting without Redis (in-memory fallback)"
      unset REDIS_URL
    fi
    sleep 1
  done
else
  echo "[entrypoint] No REDIS_URL set — using in-memory rate limiting"
fi

# ── Optionally wait for PostgreSQL ────────────────────────────────────────
if [ -n "$DATABASE_URL" ] && echo "$DATABASE_URL" | grep -q "^postgres"; then
  echo "[entrypoint] PostgreSQL configured — will use Postgres backend"
fi

# ── Build proxy args from env vars (no CLI flags needed) ──────────────────
PROXY_ARGS=""
if [ -n "$MASTYF_AI_CONFIG_PATH" ]; then
  PROXY_ARGS="$PROXY_ARGS --config $MASTYF_AI_CONFIG_PATH"
fi
if [ -n "$MASTYF_AI_POLICY_PATH" ]; then
  PROXY_ARGS="$PROXY_ARGS --policy $MASTYF_AI_POLICY_PATH"
fi
if [ -n "$MASTYF_AI_BLOCKING_MODE" ]; then
  PROXY_ARGS="$PROXY_ARGS --blocking-mode $MASTYF_AI_BLOCKING_MODE"
fi

echo "[entrypoint] Starting Mastyf AI with: node dist/cli.js proxy $PROXY_ARGS"
exec node dist/cli.js proxy $PROXY_ARGS "$@"
