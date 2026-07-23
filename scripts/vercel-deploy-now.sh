#!/usr/bin/env bash
# Quick production deploy to Vercel (default *.vercel.app URL).
# Uses existing production env on the project unless you pass DATABASE_URL / AUTH_SECRET.
#
# Usage:
#   VERCEL_TOKEN=... ./scripts/vercel-deploy-now.sh
#   # or after `npx vercel login`:
#   ./scripts/vercel-deploy-now.sh
#
# Optional:
#   APP_URL=https://mastyf-ai-cloud.vercel.app   (default)
#   DATABASE_URL=postgresql://...                (Neon — skip if already on Vercel)
#   SKIP_ENV=1                                   (code-only deploy)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLOUD="$ROOT/apps/cloud"
SCOPE="${VERCEL_SCOPE:-mastyf-ai-gmailcoms-projects}"
PROJECT="${VERCEL_PROJECT:-mastyf-ai-cloud}"
APP_URL="${APP_URL:-https://mastyf-ai-cloud.vercel.app}"
VERCEL_CLI="${VERCEL_CLI:-npx vercel@48}"

token_args=()
if [[ -n "${VERCEL_TOKEN:-}" ]]; then
  token_args=(--token "$VERCEL_TOKEN")
fi

run_vercel() {
  if ((${#token_args[@]})); then
    $VERCEL_CLI "$@" "${token_args[@]}"
  else
    $VERCEL_CLI "$@"
  fi
}

echo "==> Building cloud app locally..."
cd "$ROOT"
pnpm --filter @mastyf_ai/cloud run build

echo "==> Vercel account:"
run_vercel whoami 2>/dev/null || {
  echo "ERROR: Not logged in. Run one of:"
  echo "  export VERCEL_TOKEN=...   # https://vercel.com/account/tokens"
  echo "  npx vercel login"
  exit 1
}

link_project() {
  local dir="$1"
  cd "$dir"
  rm -rf .vercel
  run_vercel link --yes --scope "$SCOPE" --project "$PROJECT"
}

add_env() {
  local name="$1"
  local value="$2"
  echo "  + $name"
  printf '%s' "$value" | $VERCEL_CLI env add "$name" production --force --scope "$SCOPE" "${token_args[@]+"${token_args[@]}"}" >/dev/null 2>&1 \
    || printf '%s' "$value" | $VERCEL_CLI env add "$name" production --scope "$SCOPE" "${token_args[@]+"${token_args[@]}"}"
}

if [[ "${SKIP_ENV:-}" != "1" ]]; then
  if [[ -n "${DATABASE_URL:-}" ]] && [[ "$DATABASE_URL" == *localhost* || "$DATABASE_URL" == *127.0.0.1* ]]; then
    echo "WARN: DATABASE_URL points at localhost — skipping env sync (using existing Vercel production env)."
    echo "      Set a Neon URL to update: DATABASE_URL=postgresql://... ./scripts/vercel-deploy-now.sh"
  else
    echo "==> Syncing production environment variables..."
    link_project "$CLOUD"

    if [[ -n "${DATABASE_URL:-}" ]]; then
      add_env DATABASE_URL "$DATABASE_URL"
    else
      echo "  (skip DATABASE_URL — not set; keeping existing Vercel value)"
    fi

    AUTH_SECRET="${AUTH_SECRET:-$(openssl rand -base64 32)}"
    LICENSE_JWT_SECRET="${LICENSE_JWT_SECRET:-$AUTH_SECRET}"
    add_env AUTH_URL "$APP_URL"
    add_env NEXT_PUBLIC_APP_URL "$APP_URL"
    add_env NEXT_PUBLIC_CLOUD_URL "$APP_URL"
    add_env MASTYF_AI_CLOUD_PUBLIC_URL "$APP_URL"

    if [[ -n "${AUTH_SECRET_PROVIDED:-}" || -n "${AUTH_SECRET:-}" ]]; then
      add_env AUTH_SECRET "$AUTH_SECRET"
      add_env LICENSE_JWT_SECRET "$LICENSE_JWT_SECRET"
    fi
  fi
fi

echo "==> Deploying to production..."
link_project "$ROOT"
run_vercel deploy --prod --yes --scope "$SCOPE"

echo ""
echo "Done. Live at: $APP_URL"
echo "Verify: APP_URL=$APP_URL pnpm cloud:verify-prod"
