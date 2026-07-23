#!/usr/bin/env bash
# Publish all @mastyf_ai packages (skip build). Use after pnpm run build.
# Server/CLI publish from .tgz so registry manifest matches tarball.
# Requires interactive Terminal for --auth-type=web (browser SSO / passkey).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PUBLISH_ARGS=(--access public)
if [[ -n "${NPM_AUTH_TYPE:-}" ]]; then
  PUBLISH_ARGS+=(--auth-type="$NPM_AUTH_TYPE")
elif [[ -n "${NPM_OTP:-}" ]]; then
  PUBLISH_ARGS+=(--otp="$NPM_OTP")
else
  PUBLISH_ARGS+=(--auth-type=web)
fi

echo "npm user: $(npm whoami)"
echo "When prompted, press ENTER and complete browser auth for each package."

publish_pkg() {
  local dir="$1"
  echo ""
  echo "=== Publishing $(node -p "require('./${dir}/package.json').name")@$(node -p "require('./${dir}/package.json').version") ==="
  (cd "$dir" && npm publish "${PUBLISH_ARGS[@]}")
}

publish_pkg packages/plugin-sdk
publish_pkg packages/core

echo ""
echo "=== Publishing @mastyf_ai/server from tarball ==="
node scripts/validate-npm-pack.mjs
SERVER_TGZ=$(npm pack --silent 2>/dev/null | grep '\.tgz$' | tail -1)
npm publish "$SERVER_TGZ" "${PUBLISH_ARGS[@]}"
rm -f "$SERVER_TGZ"

echo ""
echo "=== Publishing @mastyf_ai/cli from tarball ==="
(cd packages/cli && node ../../scripts/validate-npm-pack.mjs)
CLI_TGZ=$(cd packages/cli && npm pack --silent 2>/dev/null | grep '\.tgz$' | tail -1)
(cd packages/cli && npm publish "$CLI_TGZ" "${PUBLISH_ARGS[@]}")
rm -f "packages/cli/$CLI_TGZ"

echo ""
echo "Done. Verify:"
echo "  npm view @mastyf_ai/server@$(node -p "require('./package.json').version") dependencies"
