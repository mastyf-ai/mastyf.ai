# Mastyf Shield for VS Code

See, from inside your editor, whether your AI agent's MCP servers are protected by Mastyf Shield, and what Shield stopped and why.

Works in VS Code, VS Code Insiders, Cursor and Windsurf. Needs the Mastyf Shield app, Mastyf's paid protection for Windows: sign up and choose a plan at [mastyf.ai](https://www.mastyf.ai), then install Shield. This extension then shows what it does.

Looking for something free? Mastyf's free checks for your own agents are the [`mastyf-ai`](https://pypi.org/project/mastyf-ai/) (Python) and [`@mastyf_ai/guard`](https://www.npmjs.com/package/@mastyf_ai/guard) (TypeScript) libraries, which run on your own machine.

## What it shows

- **Status bar:** whether this editor's MCP servers are routed through Shield: `Protected`, `2 of 5 protected`, `Off`, or `Reload to apply` when the settings changed after the window started. Hover for the servers that aren't covered and why.
- **Blocked calls:** a panel with the calls Shield stopped, newest first. Expand one to see what blocked it: the check that caught it, the rule, the exact words it matched, and the argument they were in.
- **Notifications:** a short note when Shield blocks a call from this editor or its agents (Claude Code, Cline). Several at once become one note.
- **Turn on protection:** with Shield 0.6 or later, one command asks Shield to protect your agents, as Shield's own switch does; then reload the window. With an older Shield, the steps and a button to open it.

The extension checks nothing itself and never edits a settings file: Shield does the checking and the routing, and this shows you what it did. It can ask Shield to turn protection on, never off; turning it off is done in Shield.

## Install Shield

Sign up at [mastyf.ai](https://www.mastyf.ai), choose a plan, and download Shield from your account.

> Install Shield only from mastyf.ai. Shield is not code-signed yet, so Windows may show "Windows protected your PC". For a file you downloaded from mastyf.ai, choose More info, then Run anyway. A copy from anywhere else (another website, a shared drive, an attachment or a message) may have been changed: do not run it. Mastyf cannot vouch for such copies and is not responsible for what they do.

Then run **Mastyf Shield: Turn on protection** from the Command Palette (or, in Shield, go to **Account → Protection** and turn on **Route MCP servers through Shield**), and reload this window.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `mastyfShield.port` | `14000` | The port of the Shield app's local service on this PC. |
| `mastyfShield.notifyOnBlock` | `true` | Show a notification when Shield blocks a call from this editor's servers. |
| `mastyfShield.pollSeconds` | `15` | How often (in seconds) to check Shield for new blocks while this window has focus (5 to 3600). |

## Privacy

- The extension talks only to the Shield app on your own PC (`127.0.0.1`), using the keys Shield keeps on this PC (one to read what Shield blocked, one for its protection switch). The keys never leave your PC, never follow a redirect, and are never logged.
- No telemetry. Nothing is sent anywhere else.
- It reads your editor's MCP settings files to see which servers are routed. It never follows paths in those files to network shares.

## Limits in this version

- Windows only, like Shield. On Mac and Linux the status bar says so.
- "Protected" covers the settings files Shield manages. Servers from other VS Code profiles, other extensions, remote or WSL windows aren't counted.
- VS Code Insiders needs Shield 0.6 or later.
- Which agent made each call is shown with Shield 0.6 or later; with an older Shield, "this editor" is worked out from the server names in its settings.
