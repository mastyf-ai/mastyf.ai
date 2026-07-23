#!/usr/bin/env bash
# Publish @mastyf_ai/plugin-sdk and @mastyf_ai/core for the current monorepo version
# when server was published without its dependency chain (install fails with ETARGET).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT/scripts/publish-npm-all.sh"
