#!/usr/bin/env sh
# SHA-256 for every installer in dist/. Publish the file next to the download links.
set -eu
APP="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$APP/dist"
OUT="$DIST/SHA256SUMS"
if [ ! -d "$DIST" ]; then
  echo "[checksums] no $DIST" >&2
  exit 1
fi
: > "$OUT"
for f in "$DIST"/*.dmg "$DIST"/*.exe "$DIST"/*.AppImage "$DIST"/*.deb "$DIST"/*.rpm "$DIST"/*.zip; do
  [ -f "$f" ] || continue
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$f" >> "$OUT"
  else
    sha256sum "$f" >> "$OUT"
  fi
done
echo "[checksums] wrote $OUT"
cat "$OUT"
