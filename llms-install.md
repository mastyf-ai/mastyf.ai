# mastyf.ai — MCP Security Proxy

## Install

```bash
# Prerequisites: Node.js >= 18, npm
npm install -g @mastyf_ai/server@latest
```

## Usage

```bash
# Start the proxy (stdio transport for MCP clients)
mastyf-ai proxy

# Or start with the dashboard
DASHBOARD_ENABLED=true mastyf-ai proxy

# Run a security scan
mastyf-ai scan --config /path/to/mcp-servers.json

# Generate a full report
mastyf-ai report --config /path/to/mcp-servers.json
```

## MCP Config

Add to your Cline MCP settings:

```json
{
  "mcpServers": {
    "mastyf-ai": {
      "command": "mastyf-ai",
      "args": ["proxy"],
      "env": {
        "MASTYF_AI_BLOCK_ON_CVE": "false"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | No | Enables semantic LLM analysis layer |
| `NVD_API_KEY` | No | NIST NVD API key for CVE lookups |
| `DASHBOARD_ENABLED` | No | Set `true` to enable web dashboard on port 4000 |
| `REDIS_URL` | No | Redis connection for HA rate limiting |
| `ALERT_WEBHOOK_URL` | No | Slack/Discord webhook for critical alerts |

## Verification

```bash
mastyf-ai --version
# Should output: 4.1.12
```
