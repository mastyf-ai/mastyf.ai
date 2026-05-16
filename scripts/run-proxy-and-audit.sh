#!/bin/bash
set -e
cd "$(dirname "$0")/.." || exit 1
rm -f ~/.mcp-guardian/history.db

echo "=== Starting proxy ==="
node dist/cli.js proxy \
  --config "$HOME/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json" \
  --policy ./default-policy.yaml \
  --blocking-mode warn &
PROXY_PID=$!
sleep 2

echo "=== Sending realistic tools/call messages ==="
echo '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"search_repositories","arguments":{"query":"mcp-guardian security proxy typeScript"}}}' | node dist/cli.js proxy --config "$HOME/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json" 2>/dev/null &
sleep 1
echo '{"jsonrpc":"2.0","id":"2","method":"tools/call","params":{"name":"get_file_contents","arguments":{"path":"README.md"}}}' | node dist/cli.js proxy --config "$HOME/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json" 2>/dev/null &
sleep 1
echo '{"jsonrpc":"2.0","id":"3","method":"tools/call","params":{"name":"search","arguments":{"query":"how to implement OAuth 2.1 JWT validation"}}}' | node dist/cli.js proxy --config "$HOME/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json" 2>/dev/null &
sleep 1
echo '{"jsonrpc":"2.0","id":"4","method":"tools/call","params":{"name":"list_directory","arguments":{"path":"src"}}}' | node dist/cli.js proxy --config "$HOME/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json" 2>/dev/null &
sleep 1
echo '{"jsonrpc":"2.0","id":"5","method":"tools/call","params":{"name":"execute_command","arguments":{"command":"ls -la"}}}' | node dist/cli.js proxy --config "$HOME/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json" 2>/dev/null &
sleep 2

kill $PROXY_PID 2>/dev/null || true
sleep 1
echo "=== Proxy stopped ==="