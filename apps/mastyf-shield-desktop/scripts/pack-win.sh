#!/usr/bin/env sh
# Windows NSIS/.exe — run on Windows (or electron-builder with wine). Authenticode is env-driven.
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
APP="$ROOT/apps/mastyf-shield-desktop"
cd "$APP"

if [ ! -d node_modules/electron ] || [ ! -d node_modules/electron-builder ]; then
  npm install
fi

if [ ! -d "$APP/.pack-resources/stack" ]; then
  sh "$ROOT/scripts/stage-shield-bundle.sh"
else
  echo "[pack-win] reusing existing staged stack from .pack-resources/stack" >&2
fi

# Clean up any third-party .exe files inside staged resources so electron-builder doesn't attempt to sign them
find "$APP/.pack-resources" -type f -name "*.exe" -delete 2>/dev/null || true

export CSC_IDENTITY_AUTO_DISCOVERY=false

echo "[pack-win] electron-builder --win nsis zip --x64 …" >&2
npx electron-builder --win nsis zip --x64 -c.win.signAndEditExecutable=false
echo "[pack-win] artifacts under $APP/dist"
