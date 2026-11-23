# mastyf-ai-configs

Put the MCP server configs you want Mastyf to protect here, one `mcpServers` JSON file per server.
When you start Mastyf (`pnpm dashboard:proxy` or `node dist/cli.js start`), Fleet Hub starts a
checkpoint for every `.json` file in this folder, plus the MCP servers in your own agents' configs
(Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, Cline).

`examples/` holds sample configs used by the tests, the security swarm and the docs. They are
**not** started automatically, so they never show up as your servers on the dashboard. To try one,
copy it up into this folder, or pass it directly:

```bash
pnpm dashboard:proxy -- mastyf-ai-configs/examples/filesystem.json
```
