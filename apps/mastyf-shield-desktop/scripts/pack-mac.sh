#!/usr/bin/env sh
# Build macOS DMG/dir from a staged stack. Notarization is a separate step.
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
APP="$ROOT/apps/mastyf-shield-desktop"
cd "$APP"

if [ ! -d node_modules/electron ] || [ ! -d node_modules/electron-builder ]; then
  echo "[pack-mac] npm install (electron + electron-builder)…" >&2
  npm install
fi

sh "$ROOT/scripts/stage-shield-bundle.sh"

SIGN_ARGS=""
if [ -n "${MASTYF_CSC_IDENTITY:-}" ]; then
  export CSC_IDENTITY_AUTO_DISCOVERY=true
  export CSC_NAME="$MASTYF_CSC_IDENTITY"
  SIGN_ARGS="--config.mac.identity=${MASTYF_CSC_IDENTITY} --config.mac.hardenedRuntime=true"
else
  export CSC_IDENTITY_AUTO_DISCOVERY=false
  echo "[pack-mac] unsigned (set MASTYF_CSC_IDENTITY to a Developer ID Application identity)" >&2
fi

TARGET=dmg
ARCHS="${MASTYF_MAC_ARCHS:-arm64,x64}"
for arg in "$@"; do
  if [ "$arg" = "--dir" ]; then
    TARGET=dir
  fi
  if [ "$arg" = "--x64" ]; then
    ARCHS="x64"
  fi
  if [ "$arg" = "--universal" ]; then
    ARCHS="arm64,x64"
  fi
done

echo "[pack-mac] electron-builder --mac $TARGET --$ARCHS …" >&2
# shellcheck disable=SC2086
npx electron-builder --mac "$TARGET" --$ARCHS $SIGN_ARGS
echo "[pack-mac] artifacts under $APP/dist"
echo "[pack-mac] next: sh scripts/notarize-mac.sh (needs Apple ID + Developer ID cert)"
