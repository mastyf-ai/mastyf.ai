# MCP Guardian on Windows

## Supported

- Node.js 18+ (Node 20 LTS recommended) on Windows 10/11
- **Native Windows** — PowerShell proxy wrapper (`guardian-proxy.ps1`), `mcp-guardian wrap --client cursor`
- **WSL2** — Full parity with Linux (recommended if native native-module build fails)
- `mcp-guardian` CLI (`scan`, `audit`, `proxy`, `policy test`, `tui`, `wrap`)
- SQLite history at `%USERPROFILE%\.mcp-guardian\history.db`
- Path guards normalize `\` to `/` before matching sensitive-path patterns

## Quick start (native PowerShell)

```powershell
cd C:\dev\mcp-guardian
pnpm install
pnpm build
mcp-guardian wrap --client cursor --policy policy-audit.yaml --apply
```

Wrapped Cursor entries use `powershell.exe -File guardian-proxy.ps1` so paths with spaces (e.g. `C:\Users\John Doe\mcp-guardian`) are handled correctly.

### Example Cursor `mcp.json` (after wrap)

```json
{
  "mcpServers": {
    "github": {
      "command": "powershell.exe",
      "args": [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        "C:\\Users\\John Doe\\mcp-guardian\\guardian-proxy.ps1",
        "--config",
        "C:\\Users\\John Doe\\mcp-guardian\\guardian-configs\\github.json",
        "--policy",
        "C:\\Users\\John Doe\\mcp-guardian\\policy-audit.yaml"
      ],
      "transport": "stdio"
    }
  }
}
```

Manual equivalent:

```powershell
$env:MCP_GUARDIAN_DB_PATH = "$env:USERPROFILE\.mcp-guardian\history.db"
& .\guardian-proxy.ps1 --config .\guardian-configs\github.json --policy .\policy-audit.yaml
```

## better-sqlite3 on Windows

`better-sqlite3` publishes **prebuilt binaries** for official Node.js 20 **win32-x64** on normal `npm install` / `pnpm install`. This repo lists `better-sqlite3` under `pnpm.onlyBuiltDependencies` so the native addon is built or downloaded reliably.

| Scenario | Guidance |
|----------|----------|
| Standard install | Prebuild should load; run `mcp-guardian doctor` |
| `npm install --ignore-scripts` | Prebuild skipped — **avoid**; reinstall without that flag |
| Custom Node / arm64 | May need [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/) (Desktop development with C++) |
| Build still fails | Use **WSL2** for IDE proxy + wrap, or HTTP/SSE proxy mode |

`scripts/postinstall-windows.cjs` prints hints if the native module fails to load after install.

**Not recommended:** `npm install --ignore-scripts` plus swapping in `@vscode/sqlite3` — API and packaging differ; prefer fixing the native build or WSL2.

## Known limitations

| Area | Status |
|------|--------|
| **stdio proxy** | Native PowerShell wrapper; child MCP commands must be Windows-compatible |
| **Cursor IDE** | Native Windows supported via `guardian-proxy.ps1`; WSL2 also works |
| **guardian-proxy.sh** | Unix only — use `guardian-proxy.ps1` on Windows |
| **Named pipes** | Not implemented — stdio JSON-RPC only (`TODO`: optional `\\.\pipe\` transport) |
| **File paths** | Use forward slashes in policy tests; `GUARDIAN_WORKSPACE` as `C:/dev/myproject` |
| **Shell rules** | Bash/sh patterns; PowerShell tools use `semantic-powershell-guard` |
| **Line endings** | CRLF in config files is fine |

## Environment tips

```powershell
$env:MCP_GUARDIAN_DB_PATH = "$env:USERPROFILE\.mcp-guardian\history.db"
$env:GUARDIAN_WORKSPACE = "C:/Users/you/project"
mcp-guardian policy test --policy default-policy.yaml --tool read_file --args "{\"path\":\"C:/Users/you/project/README.md\"}"
```

## Path guard note

`path-guard.ts` converts backslashes to forward slashes before regex evaluation, so `C:\Users\foo\.ssh\id_rsa` is treated the same as a Unix-style path for blocking rules.

## MSI installer

**Planned v2.7** — see [installer/README.md](../installer/README.md). No MSI is shipped in v2.6.x; use npm global install or a git clone.
