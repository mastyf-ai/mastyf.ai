#!/usr/bin/env bash
# Publish @mcp-guardian/plugin-sdk and @mcp-guardian/core for the current monorepo version
# when server was published without its dependency chain (install fails with ETARGET).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT/scripts/publish-npm-all.sh"
