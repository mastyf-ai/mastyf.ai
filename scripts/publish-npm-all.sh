#!/usr/bin/env bash
# Publish all @mastyf_ai packages in dependency order.
# Server/CLI publish from .tgz; postpack restore runs ONLY after publish so npm
# registry manifest keeps semver deps (not workspace:).
# Requires: npm login (npm whoami). Auth options:
#   NPM_AUTH_TYPE=web ./scripts/publish-npm-all.sh   # browser SSO (recommended)
#   NPM_OTP=123456 ./scripts/publish-npm-all.sh      # 2FA one-time password
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

pack_tgz() {
  npm pack --silent 2>/dev/null | grep '\.tgz$' | tail -1
  node "$ROOT/scripts/postpack-npm-deps.mjs" 2>/dev/null || true
}

publish_from_tgz() {
  local pkg_name="$1"
  local version="$2"
  local tgz="$3"
  npm publish "$tgz" "${PUBLISH_ARGS[@]}"
  sleep 3
  node "$ROOT/scripts/verify-npm-registry-manifest.mjs" "$pkg_name" "$version"
}

echo "npm user: $(npm whoami)"
echo "Building workspace packages for publish..."

build_with_tsc() {
  local tsc="$ROOT/node_modules/.bin/tsc"
  if [[ ! -x "$tsc" ]]; then
    echo "ERROR: $tsc not found. Run 'pnpm install' once in the repo when workspace packages are linkable," >&2
    echo "       or ensure packages/*/dist exists before publishing." >&2
    exit 1
  fi
  "$tsc" --project "$ROOT/packages/plugin-sdk/tsconfig.json"
  "$tsc" --project "$ROOT/packages/core/tsconfig.json"
}

if [[ -f packages/plugin-sdk/dist/index.js && -f packages/core/dist/index.js ]]; then
  echo "[publish] Using existing packages/*/dist (delete dist to force rebuild)"
else
  build_with_tsc
fi

SERVER_VERSION=$(node -p "require('./package.json').version")
if ! npm view "@mastyf_ai/server@${SERVER_VERSION}" version &>/dev/null; then
  echo "Building @mastyf_ai/server (full monorepo build)..."
  pnpm install --no-frozen-lockfile
  pnpm run build
  echo "Building dashboard SPA for npm tarball..."
  sh "$ROOT/scripts/build-dashboard-spa.sh"
  if [[ ! -f "$ROOT/deploy/dashboard-spa/out/index.html" ]]; then
    echo "ERROR: deploy/dashboard-spa/out/index.html missing after dashboard build" >&2
    exit 1
  fi
fi

publish_pkg() {
  local dir="$1"
  local name version
  name=$(node -p "require('./${dir}/package.json').name")
  version=$(node -p "require('./${dir}/package.json').version")
  if npm view "${name}@${version}" version &>/dev/null; then
    echo ""
    echo "=== Skip ${name}@${version} (already on npm) ==="
    return 0
  fi
  echo ""
  echo "=== Publishing ${name}@${version} ==="
  (cd "$dir" && npm publish "${PUBLISH_ARGS[@]}")
}

publish_pkg packages/plugin-sdk
publish_pkg packages/core

# After publishing deps, wait for registry replication then confirm chain
for dep in core plugin-sdk; do
  if npm view "@mastyf_ai/server@${SERVER_VERSION}" version &>/dev/null; then
    node "$ROOT/scripts/wait-npm-registry.mjs" "@mastyf_ai/${dep}" "$SERVER_VERSION" || true
  fi
  if npm view "@mastyf_ai/server@${SERVER_VERSION}" version &>/dev/null \
    && ! npm view "@mastyf_ai/${dep}@${SERVER_VERSION}" version &>/dev/null; then
    echo ""
    echo "WARN: @mastyf_ai/${dep}@${SERVER_VERSION} not visible yet — npm replication can take ~1 min." >&2
    echo "      Check: npm view @mastyf_ai/${dep}@${SERVER_VERSION} version" >&2
  fi
done

if npm view "@mastyf_ai/server@${SERVER_VERSION}" version &>/dev/null; then
  echo ""
  echo "=== Skip @mastyf_ai/server@${SERVER_VERSION} (already on npm) ==="
else
  echo ""
  echo "=== Publishing @mastyf_ai/server@${SERVER_VERSION} from tarball ==="
  node scripts/validate-npm-pack.mjs
  SERVER_TGZ=$(pack_tgz)
  publish_from_tgz "@mastyf_ai/server" "$SERVER_VERSION" "$SERVER_TGZ"
  node scripts/postpack-npm-deps.mjs
  rm -f "$SERVER_TGZ"
fi

CLI_VERSION=$(node -p "require('./packages/cli/package.json').version")
if npm view "@mastyf_ai/cli@${CLI_VERSION}" version &>/dev/null; then
  echo ""
  echo "=== Skip @mastyf_ai/cli@${CLI_VERSION} (already on npm) ==="
else
  echo ""
  echo "=== Publishing @mastyf_ai/cli@${CLI_VERSION} from tarball ==="
  (cd packages/cli && node ../../scripts/validate-npm-pack.mjs)
  CLI_TGZ=$(cd packages/cli && pack_tgz)
  (cd packages/cli && publish_from_tgz "@mastyf_ai/cli" "$CLI_VERSION" "$CLI_TGZ")
  (cd packages/cli && PREPACK_PKG=package.json node ../../scripts/postpack-npm-deps.mjs)
  rm -f "packages/cli/$CLI_TGZ"
fi

echo ""
echo "Done. Verify install:"
echo "  npm install -g @mastyf_ai/server@${SERVER_VERSION}"
echo "  npm view @mastyf_ai/server@${SERVER_VERSION} dependencies"
