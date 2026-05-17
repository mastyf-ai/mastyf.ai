#!/usr/bin/env bash
# Verify better-sqlite3 native bindings inside a Docker build (CI / local).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Building builder stage for prebuild verification..."
docker build --target builder -t mcp-guardian-prebuild-check:local -f Dockerfile .

echo "==> Running better-sqlite3 smoke inside builder image..."
docker run --rm mcp-guardian-prebuild-check:local \
  node -e "const Database=require('better-sqlite3'); const db=new Database(':memory:'); db.exec('SELECT 1'); console.log('OK');"

echo "==> Verifying final image runs as uid 1001..."
docker build -t mcp-guardian-nonroot-check:local -f Dockerfile .
uid="$(docker run --rm --entrypoint id mcp-guardian-nonroot-check:local)"
echo "$uid"
echo "$uid" | grep -q 'uid=1001'

echo "All Docker prebuild checks passed."
