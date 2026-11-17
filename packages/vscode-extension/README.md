# Mastyf Shield for VS Code

See, from inside your editor, whether your AI agent's MCP servers are protected by Mastyf Shield, and what Shield stopped and why.

Works in VS Code, Cursor and Windsurf. Needs the Mastyf Shield app on Windows, a free download from [mastyf.ai](https://www.mastyf.ai/download).

## What it shows

- **Status bar:** whether this editor's MCP servers are routed through Shield: `Protected`, `2 of 5 protected`, `Off`, or `Reload to apply` when the settings changed after the window started. Hover for the servers that aren't covered and why.
- **Blocked calls:** a panel with the calls Shield stopped, newest first. Expand one to see what blocked it: the check that caught it, the rule, the exact words it matched, and the argument they were in.
- **Notifications:** a short note when Shield blocks a call from this editor's servers. Several at once become one note.
- **Turn on protection:** the steps to route this editor through Shield, and a button to open Shield.

The extension checks nothing itself and never changes your settings. Shield does the checking; this shows you what it did.

## Install Shield

> Install Shield only from mastyf.ai, using the link above. Shield is not code-signed yet, so Windows may show "Windows protected your PC". For a file you downloaded from mastyf.ai, choose More info, then Run anyway. A copy from anywhere else (another website, a shared drive, an attachment or a message) may have been changed: do not run it. Mastyf cannot vouch for such copies and is not responsible for what they do.

Then open Shield, go to **Account → Protection**, turn on **Route MCP servers through Shield**, and reload this window.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `mastyfShield.port` | `14000` | The port of the Shield app's local service on this PC. |
| `mastyfShield.notifyOnBlock` | `true` | Show a notification when Shield blocks a call from this editor's servers. |
| `mastyfShield.pollSeconds` | `15` | How often to check Shield for new blocks while this window has focus (minimum 5). |

## Privacy

- The extension talks only to the Shield app on your own PC (`127.0.0.1`), using the key Shield keeps on this PC. The key never leaves your PC and is never logged.
- No telemetry. Nothing is sent anywhere else.
- It reads your editor's MCP settings files to see which servers are routed. It never follows paths in those files to network shares.

## Limits in this version

- Windows only, like Shield. On Mac and Linux the status bar says so.
- "Protected" covers the settings files Shield manages. Servers from other VS Code profiles, other extensions, remote or WSL windows aren't counted.
- VS Code Insiders isn't routed by Shield yet.
