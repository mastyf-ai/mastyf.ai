#!/usr/bin/env sh
# Next Shield UI (:3000). Loads the same dashboard API key the BFF uses.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
. "$ROOT/scripts/lib/dashboard-api-key.sh"
export DASHBOARD_AUTH_DISABLED="${DASHBOARD_AUTH_DISABLED:-false}"
if [ "$DASHBOARD_AUTH_DISABLED" != "true" ]; then
  ensure_dashboard_api_key
  echo "[dashboard-dev] Auth ON. Key file: $(dashboard_api_key_path) (value not printed)" >&2
fi
exec pnpm --filter @mastyf_ai/dashboard-spa run dev
