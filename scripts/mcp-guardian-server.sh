#!/usr/bin/env bash
export MCP_GUARDIAN_DB_PATH="/private/tmp/mcp-guardian-server.db"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; exec node "$(dirname "$SCRIPT_DIR")/dist/index.js" "$@"