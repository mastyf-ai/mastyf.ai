# MCP Guardian stdio proxy launcher (Windows native).
# Forwards to: node dist/cli.js proxy @args
# Equivalent to scripts/guardian-proxy.sh — use from repo root ($PSScriptRoot = project root).
$ErrorActionPreference = 'Stop'

$Root = $PSScriptRoot
$cliPath = Join-Path $Root 'dist\cli.js'

if (-not $env:MCP_GUARDIAN_DB_PATH) {
  $env:MCP_GUARDIAN_DB_PATH = Join-Path $env:USERPROFILE '.mcp-guardian\history.db'
}
if (-not $env:DASHBOARD_ENABLED) { $env:DASHBOARD_ENABLED = 'true' }
if (-not $env:METRICS_ENABLED) { $env:METRICS_ENABLED = 'true' }
if (-not $env:METRICS_PORT) { $env:METRICS_PORT = '9090' }
if (-not $env:DASHBOARD_PORT) { $env:DASHBOARD_PORT = '4000' }

& node "$cliPath" proxy @args
exit $LASTEXITCODE
