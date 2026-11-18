# @mastyf_ai/guard

Mastyf's free checks for your AI agent's tools. Every tool call is checked before it runs, and
every tool result before your model reads it. It all runs on your own machine: nothing is sent to
Mastyf.

```bash
npm install @mastyf_ai/guard
```

Needs Node.js 20 or later. The checks run in a separate process started on your own Node.js the
first time they're needed; it stops when your program stops and never keeps it running.

## Mastra

```ts
import { guardTools } from '@mastyf_ai/guard/mastra';

const agent = new Agent({ name: 'helper', model, tools: guardTools({ search, readFile }) });
```

## LangChain.js and LangGraph.js

```ts
import { guardTools } from '@mastyf_ai/guard/langchain';

const agent = createReactAgent({ llm, tools: guardTools([search, readFile]) });
```

## OpenAI Agents SDK

```ts
import { guardTools } from '@mastyf_ai/guard/openai-agents';

const agent = new Agent({ name: 'helper', tools: guardTools([search, readFile]) });
```

Hosted tools (web search, file search, code interpreter) run on OpenAI's servers, where no local
check can reach them. They're passed through unchanged with a warning.

Shell, computer and apply-patch tools run on your machine but can't be checked yet, so
guardTools() refuses them rather than letting them through silently.

## Any other framework

```ts
import { createGuard, isBlocked, modelMessage } from '@mastyf_ai/guard';

const guard = createGuard(); // one guard per agent run
const before = await guard.checkCall('read_file', { path });
if (isBlocked(before)) return modelMessage(before); // "Blocked by Mastyf (hooks: hook-before)."
const result = await readFile(path);
const after = await guard.checkResult('read_file', result, { path });
if (isBlocked(after)) return modelMessage(after);
return after.decision === 'redact' ? after.result : result;
```

A blocked call never runs. The model is told which check stopped it, never the text that was
matched.

Some checks look at a whole run (for example, reading a secret file and then sending data out).
A server that handles many users should give each request its own session, so one user's run
never affects another's:

```ts
const guard = createGuard();
const tools = guardTools([search, readFile], guard);

app.post('/chat', (req, res) => guard.session(req.id, async () => res.json(await agent.invoke(req.body))));
```

## MCP servers

```bash
npx mastyf-check proxy -- npx -y @modelcontextprotocol/server-filesystem ./project
```

## When no check can be made

By default a call fails with `MastyfUnavailableError` instead of running unchecked. To let calls
through with a warning instead, use `createGuard({ onUnavailable: 'allow' })`. An input the check
refuses (for example, one too large to check) is always blocked, in either mode.

- `MASTYF_CHECK_URL` and `MASTYF_CHECK_TOKEN`: use a check service you run (for example the
  Docker image) instead of starting one. This also works on Bun and Deno, where starting the
  check process isn't supported yet.
- `MASTYF_CHECK_BIN`: use a copy of the check program you already have.

## Upgrading from the old middleware

`@mastyf_ai/langchain-middleware` and `@mastyf_ai/openai-agents-middleware` sent tool calls to a
Mastyf proxy. They're replaced by `@mastyf_ai/guard/langchain` and
`@mastyf_ai/guard/openai-agents`, which don't need one.

## Paid protection

The Shield app adds Mastyf's paid checks and a dashboard of what was blocked: sign up and choose a
plan at [mastyf.ai](https://www.mastyf.ai), then install Shield. While Shield is running on the same
computer, this library uses it on its own, with no change to your code: your agent's calls are
checked by Shield and appear in your Mastyf dashboard under the agent's name (`createGuard({ agent:
'billing-bot' })`, or `MASTYF_AI_AGENT`). `guard.tier` is then `"shield"`. The library only talks to
Shield on 127.0.0.1, and only after Shield proves it holds the key in its own file.

## Licence

MIT. The check engine it starts (`@mastyf_ai/check`) is AGPL-3.0 and runs as a separate process.
