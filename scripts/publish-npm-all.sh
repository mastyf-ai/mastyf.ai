#!/usr/bin/env bash
# Publish all @mcp-guardian packages in dependency order.
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
echo "Building..."
pnpm install --no-frozen-lockfile
pnpm run build

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

SERVER_VERSION=$(node -p "require('./package.json').version")
for dep in core plugin-sdk; do
  if npm view "@mcp-guardian/server@${SERVER_VERSION}" version &>/dev/null \
    && ! npm view "@mcp-guardian/${dep}@${SERVER_VERSION}" version &>/dev/null; then
    echo ""
    echo "ERROR: @mcp-guardian/server@${SERVER_VERSION} is on npm but @mcp-guardian/${dep}@${SERVER_VERSION} is missing." >&2
    echo "       Publish dependencies first, then retry install." >&2
    exit 1
  fi
done

if npm view "@mcp-guardian/server@${SERVER_VERSION}" version &>/dev/null; then
  echo ""
  echo "=== Skip @mcp-guardian/server@${SERVER_VERSION} (already on npm) ==="
else
  echo ""
  echo "=== Publishing @mcp-guardian/server@${SERVER_VERSION} from tarball ==="
  node scripts/validate-npm-pack.mjs
  SERVER_TGZ=$(pack_tgz)
  publish_from_tgz "@mcp-guardian/server" "$SERVER_VERSION" "$SERVER_TGZ"
  node scripts/postpack-npm-deps.mjs
  rm -f "$SERVER_TGZ"
fi

CLI_VERSION=$(node -p "require('./packages/cli/package.json').version")
if npm view "@mcp-guardian/cli@${CLI_VERSION}" version &>/dev/null; then
  echo ""
  echo "=== Skip @mcp-guardian/cli@${CLI_VERSION} (already on npm) ==="
else
  echo ""
  echo "=== Publishing @mcp-guardian/cli@${CLI_VERSION} from tarball ==="
  (cd packages/cli && node ../../scripts/validate-npm-pack.mjs)
  CLI_TGZ=$(cd packages/cli && pack_tgz)
  (cd packages/cli && publish_from_tgz "@mcp-guardian/cli" "$CLI_VERSION" "$CLI_TGZ")
  (cd packages/cli && PREPACK_PKG=package.json node ../../scripts/postpack-npm-deps.mjs)
  rm -f "packages/cli/$CLI_TGZ"
fi

echo ""
echo "Done. Verify install:"
echo "  npm install -g @mcp-guardian/server@${SERVER_VERSION}"
echo "  npm view @mcp-guardian/server@${SERVER_VERSION} dependencies"
