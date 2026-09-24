#!/usr/bin/env sh
# Windows NSIS/.exe — run on Windows (or electron-builder with wine). Authenticode is env-driven.
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
APP="$ROOT/apps/mastyf-shield-desktop"
cd "$APP"

if [ ! -d node_modules/electron ] || [ ! -d node_modules/electron-builder ]; then
  npm install
fi

sh "$ROOT/scripts/stage-shield-bundle.sh"

if [ -z "${CSC_LINK:-}" ] && [ -z "${WINDOWS_CERT_FILE:-}" ]; then
  echo "[pack-win] no Authenticode CSC_LINK — SmartScreen will treat this as unsigned" >&2
  export CSC_IDENTITY_AUTO_DISCOVERY=false
fi

echo "[pack-win] electron-builder --win nsis …" >&2
npx electron-builder --win nsis
echo "[pack-win] artifacts under $APP/dist"
