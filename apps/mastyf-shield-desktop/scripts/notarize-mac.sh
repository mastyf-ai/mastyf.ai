#!/usr/bin/env sh
# Notarize and staple a Mac artifact. Requires Apple Developer Program credentials.
# This script does not invent certificates. It fails closed if they are missing.
set -eu
APP="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$APP/dist"

if [ -z "${APPLE_ID:-}" ] || [ -z "${APPLE_APP_SPECIFIC_PASSWORD:-}" ] || [ -z "${APPLE_TEAM_ID:-}" ]; then
  echo "[notarize] missing APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID" >&2
  echo "[notarize] unsigned DMGs are not a product. Enroll in Apple Developer Program (~\$99/year), sign with Developer ID Application, then re-run." >&2
  exit 1
fi

ARTIFACT="${1:-}"
if [ -z "$ARTIFACT" ]; then
  ARTIFACT="$(ls -1t "$DIST"/*.dmg 2>/dev/null | head -n 1 || true)"
fi
if [ -z "$ARTIFACT" ] || [ ! -f "$ARTIFACT" ]; then
  echo "[notarize] no DMG found under $DIST" >&2
  exit 1
fi

echo "[notarize] submitting $ARTIFACT" >&2
xcrun notarytool submit "$ARTIFACT" \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait
xcrun stapler staple "$ARTIFACT"
echo "[notarize] stapled $ARTIFACT"
