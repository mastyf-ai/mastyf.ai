#!/usr/bin/env sh
# Stage Gateway + BFF + static Shield UI + policy into extraResources.
# Run on the OS/arch you intend to ship. This is not a cross-compiler.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/apps/mastyf-shield-desktop"
STAGE="$APP/.pack-resources"
STACK="$STAGE/stack"
DEPLOY_STAGE="$STAGE/deployment"

echo "[stage-shield] staging into $STAGE" >&2
rm -rf "$STAGE"
mkdir -p "$DEPLOY_STAGE" \
  "$STACK/gateway" \
  "$STACK/bff/dist" \
  "$STACK/deploy/dashboard-spa" \
  "$STACK/policy" \
  "$STACK/configs" \
  "$STACK/legal" \
  "$STACK/node/bin"

cp -f "$ROOT/deployment/Modelfile" "$DEPLOY_STAGE/Modelfile"
cp -f "$ROOT/deployment/v6-deployment-manifest.json" "$DEPLOY_STAGE/v6-deployment-manifest.json"
if [ "${MASTYF_BUNDLE_GGUF:-0}" = "1" ]; then
  echo "[stage-shield] bundling GGUF…" >&2
  sh "$ROOT/scripts/fetch-guard-gguf.sh"
  cp -f "$ROOT/deployment/mastyf-guard-v6-q4_k_m.gguf" "$DEPLOY_STAGE/mastyf-guard-v6-q4_k_m.gguf"
else
  echo "[stage-shield] skipping GGUF (set MASTYF_BUNDLE_GGUF=1 to include ~940MB)" >&2
fi

NEED_BFF_BUILD=0
if [ "${MASTYF_SKIP_BFF_BUILD:-0}" = "1" ]; then
  NEED_BFF_BUILD=0
elif [ ! -f "$ROOT/dist/cli.js" ] || [ ! -f "$ROOT/dist/license/offline-license.js" ]; then
  NEED_BFF_BUILD=1
elif [ "$ROOT/src/license/license-client.ts" -nt "$ROOT/dist/license/license-client.js" ]; then
  NEED_BFF_BUILD=1
elif [ "$ROOT/src/utils/dashboard-server.ts" -nt "$ROOT/dist/utils/dashboard-server.js" ]; then
  NEED_BFF_BUILD=1
elif [ "$ROOT/src/clients/gateway-client.ts" -nt "$ROOT/dist/clients/gateway-client.js" ]; then
  NEED_BFF_BUILD=1
elif [ "$ROOT/src/dashboard/gateway-routes.ts" -nt "$ROOT/dist/dashboard/gateway-routes.js" ]; then
  NEED_BFF_BUILD=1
fi
if [ "$NEED_BFF_BUILD" = "1" ]; then
  echo "[stage-shield] building BFF dist…" >&2
  (cd "$ROOT" && pnpm exec tsc --project tsconfig.json)
fi
if [ ! -f "$ROOT/dist/cli.js" ]; then
  echo "[stage-shield] missing dist/cli.js — cannot stage a customer stack" >&2
  exit 1
fi
rsync -a --delete "$ROOT/dist/" "$STACK/bff/dist/"

SPA_OUT="$ROOT/deploy/dashboard-spa/out/index.html"
SPA_SRC="$ROOT/deploy/dashboard-spa/app/layout.tsx"
if [ "${MASTYF_SKIP_SPA_BUILD:-0}" = "1" ] && [ -f "$SPA_OUT" ]; then
  echo "[stage-shield] using existing Shield UI static export…" >&2
elif [ ! -f "$SPA_OUT" ] || [ "$SPA_SRC" -nt "$SPA_OUT" ] || [ "$ROOT/deploy/dashboard-spa/app/design/appliance.css" -nt "$SPA_OUT" ]; then
  echo "[stage-shield] building Shield UI static export…" >&2
  sh "$ROOT/scripts/build-dashboard-spa.sh"
fi
if [ ! -f "$ROOT/deploy/dashboard-spa/out/index.html" ]; then
  echo "[stage-shield] missing deploy/dashboard-spa/out/index.html" >&2
  exit 1
fi
rsync -a --delete "$ROOT/deploy/dashboard-spa/out/" "$STACK/deploy/dashboard-spa/out/"

rsync -a --delete \
  --exclude '.venv*' \
  --exclude '__pycache__' \
  --exclude '*.egg-info' \
  --exclude 'logs' \
  "$ROOT/mastyf_gateway/" "$STACK/gateway/"

cp -f "$ROOT/default-policy.yaml" "$STACK/policy/default-policy.yaml"
cp -f "$ROOT/mastyf-ai-configs/filesystem.json" "$STACK/configs/filesystem.json"
cp -f "$APP/legal/"*.md "$STACK/legal/"
cp -f "$APP/python-requirements-slim.txt" "$STACK/python-requirements-slim.txt"

if [ -n "${MASTYF_LICENSE_PUBLIC_KEY_FILE:-}" ] && [ -f "$MASTYF_LICENSE_PUBLIC_KEY_FILE" ]; then
  cp -f "$MASTYF_LICENSE_PUBLIC_KEY_FILE" "$STACK/license-public.pem"
  echo "[stage-shield] using production license public key" >&2
else
  cp -f "$APP/dev-license-public.pem" "$STACK/license-public.pem"
  echo "[stage-shield] WARNING: bundled DEV license public key. Set MASTYF_LICENSE_PUBLIC_KEY_FILE for a saleable build." >&2
fi

NODE_SRC="$(command -v node || true)"
if [ -n "$NODE_SRC" ]; then
  cp -fL "$NODE_SRC" "$STACK/node/bin/node"
  chmod +x "$STACK/node/bin/node"
else
  echo "[stage-shield] WARNING: no node on PATH to embed" >&2
fi

if [ "${MASTYF_SKIP_BFF_DEPS:-0}" != "1" ]; then
  echo "[stage-shield] installing production BFF node_modules (this can take several minutes)…" >&2
  node -e '
const { readFileSync, writeFileSync } = require("fs");
const src = JSON.parse(readFileSync(process.argv[1], "utf8"));
const deps = { ...src.dependencies };
delete deps["@mastyf_ai/core"];
delete deps["@mastyf_ai/mcp-server"];
delete deps["@mastyf_ai/plugin-sdk"];
deps["@modelcontextprotocol/server-filesystem"] = src.devDependencies["@modelcontextprotocol/server-filesystem"] || "^2026.1.14";
deps.undici = deps.undici || "^7.28.0";
deps.ajv = deps.ajv || "^8.17.1";
writeFileSync(process.argv[2], JSON.stringify({
  name: "mastyf-shield-bff",
  private: true,
  type: "module",
  dependencies: deps,
}, null, 2));
' "$ROOT/package.json" "$STACK/bff/package.json"
  # Node 23 has no better-sqlite3 prebuild; node-gyp also fails on Homebrew Python 3.14.
  # Install JS deps without compile, then copy workspace packages + native addon.
  # Workspace copies MUST be after npm install — npm prunes packages not in package.json.
  (cd "$STACK/bff" && npm install --omit=dev --no-fund --no-audit --ignore-scripts)
  mkdir -p "$STACK/bff/node_modules/@mastyf_ai"
  rsync -a --delete --exclude node_modules --exclude .git --exclude tests \
    "$ROOT/packages/core/" "$STACK/bff/node_modules/@mastyf_ai/core/"
  rsync -a --delete --exclude node_modules --exclude .git --exclude tests \
    "$ROOT/packages/server/" "$STACK/bff/node_modules/@mastyf_ai/mcp-server/"
  rsync -a --delete --exclude node_modules --exclude .git --exclude tests \
    "$ROOT/packages/plugin-sdk/" "$STACK/bff/node_modules/@mastyf_ai/plugin-sdk/"
  UNDICI="$(find "$ROOT/node_modules/.pnpm" -path '*node_modules/undici/package.json' | head -n 1 || true)"
  if [ -n "$UNDICI" ]; then
    UNDICI_SRC="$(cd "$(dirname "$UNDICI")" && pwd)"
    mkdir -p "$STACK/bff/node_modules/undici"
    rsync -a --delete "$UNDICI_SRC/" "$STACK/bff/node_modules/undici/"
    echo "[stage-shield] copied workspace undici" >&2
  fi
  (cd "$STACK/bff" && NODE_PATH="$STACK/bff/node_modules" "$STACK/node/bin/node" --input-type=module -e \
    'await import("@mastyf_ai/core"); await import("./dist/policy/policy-watcher.js"); console.log("[stage-shield] bff workspace imports ok")')
  if ! grep -q "Offline Shield license accepted" "$STACK/bff/dist/license/license-client.js"; then
    echo "[stage-shield] staged BFF dist is too old for MSH1 offline licenses" >&2
    exit 1
  fi
  if ! grep -q "MASTYF_AI_DEPLOY_DIR" "$STACK/bff/dist/utils/dashboard-server.js"; then
    echo "[stage-shield] staged dashboard-server.js ignores MASTYF_AI_DEPLOY_DIR — SPA will be the stub page" >&2
    exit 1
  fi
  BS3="$(find "$ROOT/node_modules/.pnpm" -path '*better-sqlite3@*/node_modules/better-sqlite3/build/Release/better_sqlite3.node' | head -n 1 || true)"
  if [ -n "$BS3" ]; then
    BS3_SRC="$(cd "$(dirname "$BS3")/../.." && pwd)"
    mkdir -p "$STACK/bff/node_modules/better-sqlite3"
    rsync -a --delete "$BS3_SRC/" "$STACK/bff/node_modules/better-sqlite3/"
    echo "[stage-shield] copied workspace better-sqlite3 native addon" >&2
  else
    echo "[stage-shield] WARNING: no prebuilt better-sqlite3 in the workspace" >&2
  fi
else
  echo "[stage-shield] MASTYF_SKIP_BFF_DEPS=1 — BFF node_modules not staged" >&2
fi

PY="${MASTYF_PYTHON:-}"
if [ -z "$PY" ]; then
  if [ -x "$ROOT/.venv-soup/bin/python" ]; then
    PY="$ROOT/.venv-soup/bin/python"
  else
    PY="$(command -v python3 || true)"
  fi
fi
if [ -n "$PY" ] && [ "${MASTYF_SKIP_PYTHON_VENV:-0}" != "1" ]; then
  echo "[stage-shield] creating slim Python venv with ${PY}..." >&2
  "$PY" -m venv --copies "$STACK/python-venv"
  "$STACK/python-venv/bin/pip" install --upgrade pip
  "$STACK/python-venv/bin/pip" install -r "$STACK/python-requirements-slim.txt"
else
  echo "[stage-shield] WARNING: no slim Python venv. Customer machine must already have python3 + serve deps." >&2
fi

cat > "$STACK/BUILD.json" <<EOF
{
  "product": "mastyf-shield",
  "version": "$(node -p "require('$APP/package.json').version")",
  "stagedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "platform": "$(uname -s)",
  "arch": "$(uname -m)",
  "ggufBundled": $([ "${MASTYF_BUNDLE_GGUF:-0}" = "1" ] && echo true || echo false)
}
EOF

echo "[stage-shield] staged $STACK" >&2
