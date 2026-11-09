#!/usr/bin/env sh
# Build deploy/dashboard-spa (Next static export).
# Works when dashboard-spa is in the pnpm workspace OR on older clones (npm install in SPA dir).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SPA="$ROOT/deploy/dashboard-spa"

if [ ! -f "$SPA/package.json" ]; then
  echo "[dashboard:build] Missing $SPA/package.json" >&2
  exit 1
fi

in_workspace() {
  grep -q 'deploy/dashboard-spa' "$ROOT/pnpm-workspace.yaml" 2>/dev/null
}

has_next() {
  [ -x "$SPA/node_modules/.bin/next" ] \
    || [ -x "$ROOT/node_modules/.bin/next" ] \
    || command -v next >/dev/null 2>&1
}

if in_workspace; then
  if ! has_next; then
    echo "[dashboard:build] Installing dashboard-spa workspace deps…" >&2
    (cd "$ROOT" && pnpm install --filter @mastyf_ai/dashboard-spa...)
  fi
  exec pnpm --dir "$ROOT" --filter @mastyf_ai/dashboard-spa run build
fi

echo "[dashboard:build] dashboard-spa not in pnpm-workspace — using npm in $SPA" >&2
if [ ! -x "$SPA/node_modules/.bin/next" ]; then
  echo "[dashboard:build] npm install in deploy/dashboard-spa…" >&2
  (cd "$SPA" && npm install)
fi
exec sh -c "cd \"$SPA\" && npm run build"
