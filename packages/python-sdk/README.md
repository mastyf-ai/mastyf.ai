# mastyf-ai

Mastyf's free checks for your AI agent's tools. Every tool call is checked before it runs, and
every tool result before your model reads it. It all runs on your own machine: nothing is sent to
Mastyf.

```bash
pip install "mastyf-ai[langchain]"      # or [langgraph], [openai-agents]
```

The first check starts Mastyf's free check program on this machine (downloaded once from the
project's GitHub release and run only if its SHA-256 matches the one in this package). It stops
when your program stops.

## LangChain

```python
from mastyf_ai.langchain import guard_tools

agent = create_agent(model, tools=guard_tools([search, read_file]))
```

## LangGraph

```python
from langgraph.prebuilt import ToolNode
from mastyf_ai.langgraph import guard_tool_node

graph.add_node("tools", guard_tool_node(ToolNode([search, read_file])))
```

## OpenAI Agents SDK

```python
from agents import Agent
from mastyf_ai.openai_agents import guard_function_tools

agent = Agent(name="helper", tools=guard_function_tools([search, read_file]))
```

Hosted tools (web search, file search, code interpreter) run on OpenAI's servers, where no local
check can reach them. They're passed through unchanged and a warning is logged.

Shell, computer and apply-patch tools run on your machine but can't be checked yet, so
guard_function_tools() refuses them rather than letting them through silently.

## Any other framework

```python
from mastyf_ai import Guard

guard = Guard()                      # one Guard per agent run
verdict = guard.check_call("read_file", {"path": path})
if verdict.blocked:
    return verdict.model_message()   # "Blocked by Mastyf (hooks: hook-before)."
result = read_file(path)
after = guard.check_result("read_file", result, {"path": path})
if after.blocked:
    return after.model_message()
return after.result if after.decision == "redact" else result
```

A blocked call never runs. The model is told which check stopped it, never the text that was
matched.

Some checks look at a whole run (for example, reading a secret file and then sending data out).
An agent that serves many users should give each request its own session, so one user's run
never affects another's:

```python
guard = Guard()
tools = guard_tools([search, read_file], guard=guard)

async def handle(request):
    with guard.session(request.id):
        return await agent.ainvoke(request.messages)
```

## MCP servers

Run an MCP server through the check program and every call and result passes through the same
checks:

```bash
mastyf-check proxy -- npx -y @modelcontextprotocol/server-filesystem ./project
```

## When no check can be made

By default a call fails with `MastyfUnavailable` instead of running unchecked. To let calls
through with a warning instead, use `Guard(on_unavailable="allow")`. An input the check refuses
(for example, one too large to check) is always blocked, in either mode.

Other settings:

- `MASTYF_CHECK_URL` and `MASTYF_CHECK_TOKEN`: use a check service you run (for example the
  Docker image) instead of starting one.
- `MASTYF_CHECK_BIN`: use a copy of the check program you already have.
- `mastyf-ai status` shows which checks are in use; `mastyf-ai check read_file '{"path": "/etc/passwd"}'`
  checks one call from the terminal.

## Upgrading from 4.x

4.x sent tool calls to a Mastyf proxy (`MastyfProxy("http://localhost:4000")`). 5.0 doesn't need a
proxy: replace `MastyfProxy` and the old middleware with `guard_tools`, `guard_tool_node`,
`guard_function_tools` or `Guard` as above.

## Paid protection

The Shield app adds Mastyf's paid checks and a dashboard of what was blocked: sign up and choose a
plan at [mastyf.ai](https://www.mastyf.ai), then install Shield. While Shield is running on the same
computer, this library uses it on its own, with no change to your code: your agent's calls are
checked by Shield and appear in your Mastyf dashboard under the agent's name
(`Guard(agent="billing-bot")`, or `MASTYF_AI_AGENT`). `guard.tier` is then `"shield"`. The library
only talks to Shield on 127.0.0.1, and only after Shield proves it holds the key in its own file.

## Licence

MIT. The check program it starts is AGPL-3.0 and runs as a separate program.
