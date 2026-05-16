#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

# Use /private/tmp (not /tmp) to avoid macOS symlink issues with proper-lockfile
DB_DIR="/private/tmp"

# Clean up existing DB files from previous runs
rm -rf "$DB_DIR/proxy-github.db" "$DB_DIR/proxy-github.db.lock" "$DB_DIR/proxy-github.db-shm" "$DB_DIR/proxy-github.db-wal" 2>/dev/null || true
rm -rf "$DB_DIR/proxy-filesystem.db" "$DB_DIR/proxy-filesystem.db.lock" "$DB_DIR/proxy-filesystem.db-shm" "$DB_DIR/proxy-filesystem.db-wal" 2>/dev/null || true

# Clean up any existing processes on these ports
for port in 9001 9002; do
    lsof -ti:$port 2>/dev/null | xargs kill 2>/dev/null || true
done
sleep 1

echo "=== Starting GitHub proxy on port 9001 ==="
MCP_GUARDIAN_DB_PATH="$DB_DIR/proxy-github.db" nohup npx -y mcp-proxy --port 9001 --server sse -- node dist/cli.js proxy --config /tmp/cfg-github.json --policy ./default-policy.yaml &>/tmp/p9001.log &
PID1=$!
echo "GitHub proxy: PID $PID1"

echo "=== Starting Filesystem proxy on port 9002 ==="
MCP_GUARDIAN_DB_PATH="$DB_DIR/proxy-filesystem.db" nohup npx -y mcp-proxy --port 9002 --server sse -- node dist/cli.js proxy --config /tmp/cfg-fs.json --policy ./default-policy.yaml &>/tmp/p9002.log &
PID2=$!
echo "Filesystem proxy: PID $PID2"

echo ""
echo "=== Waiting for proxies to start ==="
for i in $(seq 1 15); do
    sleep 2
    READY=1
    for port in 9001 9002; do
        CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$port/sse --max-time 2 2>/dev/null || echo "000")
        if [[ "$CODE" == 200* ]]; then
            echo "Port $port: HTTP $CODE ✓"
        else
            echo "Port $port: HTTP $CODE (still waiting...)"
            READY=0
        fi
    done
    if [ "$READY" = "1" ]; then
        echo ""
        echo "Both proxies are ready!"
        exit 0
    fi
done

echo ""
echo "WARNING: Proxies did not become ready within timeout."
echo "Check logs:"
echo "  tail -f /tmp/p9001.log"
echo "  tail -f /tmp/p9002.log"
exit 1