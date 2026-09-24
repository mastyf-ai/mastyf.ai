#!/usr/bin/env sh
# Linux AppImage + deb. Sign with your published key after this step.
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
APP="$ROOT/apps/mastyf-shield-desktop"
cd "$APP"

if [ ! -d node_modules/electron ] || [ ! -d node_modules/electron-builder ]; then
  npm install
fi

sh "$ROOT/scripts/stage-shield-bundle.sh"

echo "[pack-linux] electron-builder --linux AppImage deb …" >&2
npx electron-builder --linux AppImage deb
echo "[pack-linux] artifacts under $APP/dist"
echo "[pack-linux] publish SHA-256 and a signing key on the download page"
