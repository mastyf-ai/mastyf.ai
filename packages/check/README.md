# @mastyf_ai/check

Mastyf's free checks for an AI agent's tool calls and tool results, running on your own machine:
a call that would read a secret file or send data out is blocked before it runs, and a result
carrying hidden instructions or a secret is blocked or cleaned before the model reads it.
Everything runs locally; nothing is sent to Mastyf.

Most people don't use this package directly: the [`mastyf-ai`](https://pypi.org/project/mastyf-ai/)
(Python) and [`@mastyf_ai/guard`](https://www.npmjs.com/package/@mastyf_ai/guard) (TypeScript)
libraries start it for you, and the GitHub Action `mastyf-ai/protect-agent` runs it in CI.

```bash
npx @mastyf_ai/check serve
```

## Commands

- `mastyf-check serve [--port 4100] [--host 127.0.0.1] [--policy <file>] [--mode block|observe]` —
  the check API on this machine. The token is in `~/.mastyf/check/token`
  (Windows: `%APPDATA%\Mastyf\check\token`), or set `MASTYF_CHECK_TOKEN`.
- `mastyf-check proxy [--policy <file>] -- <command> [args...]` — put the checks in front of one
  MCP server on stdio.
- `mastyf-check test <tool> '<json arguments>'` — check one call; exit code 2 when blocked.
- `mastyf-check init-copilot [--dir <repo>] [--force]` — write hooks for GitHub Copilot's coding
  agent into a repository (below).
- `mastyf-check copilot-hook pre|post` — the hook those files run; not for direct use.

## GitHub Copilot's coding agent

In your repository:

```bash
npx @mastyf_ai/check init-copilot
git add .github/hooks/mastyf.json .github/hooks/mastyf/
git commit -m "Check Copilot's tool calls with Mastyf"
```

This writes `.github/hooks/mastyf.json` (the hooks Copilot reads) and `.github/hooks/mastyf/`
(the hook and the free engine, about 3 MB, so nothing has to be downloaded during a session).
Once it's on your default branch:

- Before each tool call, the check runs; a blocked call is denied and Copilot is told
  "Blocked by Mastyf (...)", never what was matched.
- After each tool call, a blocked result (for example a page with hidden instructions) is
  replaced before Copilot reads it, and a secret is replaced by the cleaned text.
- If the checks can't run, the call is denied and the result withheld. The hook always answers
  within its time limit, because Copilot lets a call through when a hook times out.
- It works in sessions on GitHub Actions and in GitHub's cloud sandbox alike; nothing is sent to
  Mastyf.

Limits:

- Blocks show in Copilot's session log, not in a job summary, and nothing fails a build.
- Copilot's agent runs commands as the session's user, so an agent that has been misled into it
  could work around the checks with its shell. Changes to `.github/hooks/` are refused during a
  session as a best effort.
- It needs `node` in the session (GitHub's environments include it). Without it, calls are
  denied but results aren't checked.
- Not yet tried in a live Copilot session; please report anything that behaves differently.

To update, run `npx @mastyf_ai/check init-copilot --force` and commit the result.

## Paid protection

The Mastyf Shield app adds Mastyf's paid checks and a dashboard of what was blocked. Sign up at
[mastyf.ai](https://www.mastyf.ai).

## Licence

AGPL-3.0.
