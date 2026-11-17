# Mastyf: protect your agent

Free checks on every tool call and every tool result of the AI agents in your GitHub Actions job.
A call that would read a secret file, send your data out, or follow instructions hidden in a web
page is blocked before it runs. The checks run on your own runner: nothing is sent to Mastyf.

It protects agents while they run. It doesn't scan your code.

## Quick start

Add the Action before the steps that run your agent. Agents built with
[`mastyf-ai`](https://pypi.org/project/mastyf-ai/) (Python) or
[`@mastyf_ai/guard`](https://www.npmjs.com/package/@mastyf_ai/guard) (TypeScript) pick it up by
themselves, with no code change:

```yaml
jobs:
  agent-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: mastyf-ai/protect-agent@v1
        with:
          fail-on-block: true
      - run: pip install "mastyf-ai[langchain]" && pytest tests/agent
```

At the end of the job, the run's summary page lists what was blocked:

| When (UTC) | Outcome | Kind | Tool | Check |
| --- | --- | --- | --- | --- |
| 10:42:07 | blocked | call | read_file | policy: semantic-path-guard |
| 10:42:09 | secret hidden | result | show_config | |

With `fail-on-block: true`, a block turns the job red, so a pull request that makes your agent
misbehave doesn't pass. It guards against an agent being misled (for example by instructions
hidden in a page it reads), not against untrusted code in the job itself: code that runs with
the job's permissions can change the workflow or skip the libraries altogether.

## Inputs

| Input | Default | What it does |
|---|---|---|
| `fail-on-block` | `false` | Fail the job if anything was blocked (in observe mode, if anything would have been). If the checks can't be reached at the end of the job, the job fails too: that's never taken as "nothing blocked". |
| `mode` | `block` | `block` stops what the checks catch. `observe` lets everything run and lists what would have been blocked. |
| `policy` | (built-in free policy) | Path in your repository to your own policy file. |
| `port` | `0` | Port on 127.0.0.1. `0` picks a free one. |
| `max-body-mb` | `32` | Largest tool call or result to check, in MB (1-64). Larger ones are blocked, never let through. |
| `show-reasons` | `false` | Add each block's reason to the summary. Off by default: a reason can quote an argument (a path, a URL), and run pages of public repositories are public. |
| `on-error` | `fail` | `fail` stops the job if the checks can't start. `continue` warns and goes on; agents built with the libraries then start their own checks, which aren't listed in the summary. |

## Outputs

- `url`: the checks' address (later steps also get `MASTYF_CHECK_URL` and `MASTYF_CHECK_TOKEN`).
- `engine`: path of the bundled check engine, for MCP servers (below).
- `blocked-count`: tool calls blocked (or that would have been, in observe mode).
- `redacted-count`: secrets hidden from tool results. A hidden secret never fails the job: the
  model never saw it.

## MCP servers

To put an MCP server your agent uses behind the free checks, start it through the engine the
Action ships. Make the engine's path available to later steps:

```yaml
      - uses: mastyf-ai/protect-agent@v1
        id: mastyf
      - run: echo "MASTYF_ENGINE=${{ steps.mastyf.outputs.engine }}" >> "$GITHUB_ENV"
```

Then start the server through the engine in your agent's MCP configuration. Most MCP clients
don't expand variables there, so have the step that writes the configuration put in the real
path (from `$MASTYF_ENGINE`), for example:

```json
{ "command": "node", "args": ["<path from MASTYF_ENGINE>", "proxy", "--", "npx", "-y", "@modelcontextprotocol/server-filesystem", "./project"] }
```

The proxy checks calls itself, so its blocks show in the step's log, not in the job summary.

## Observe first

To see what the checks would catch before blocking anything:

```yaml
      - uses: mastyf-ai/protect-agent@v1
        with:
          mode: observe
```

## Privacy

- Everything runs on your runner, on 127.0.0.1. Nothing is sent to Mastyf, no telemetry.
- The summary names the tool and the check, never what was matched.
- The token for the checks is masked in every log.

## Limits

- Container jobs aren't supported yet (a job with `container:`); the Action stops with a clear
  message. Service containers are fine.
- Needs a runner that runs Node 24 Actions: GitHub-hosted runners do; self-hosted runners need
  v2.327.1 or later (and not macOS 13.4 or earlier, or ARM32).
- Use it once per job.
- Coming next: Claude Code (through Anthropic's GitHub Action) and GitHub Copilot's coding agent.

## Paid protection

The Mastyf Shield app adds Mastyf's paid checks and a dashboard of what was blocked. Sign up at
[mastyf.ai](https://www.mastyf.ai).

## Licence

MIT. The check engine it runs is AGPL-3.0 and runs as a separate process.
