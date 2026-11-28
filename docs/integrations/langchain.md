# Use Mastyf with LangChain and LangGraph

Mastyf checks every tool call your agent makes before the tool runs, and every tool result before
your model reads it. It stops prompt injection that arrives through tool results, reads of secret
files, data leaving through tool calls, and leaked credentials in results. The checks run on your
own machine; nothing is sent to Mastyf.

This guide covers the Python package, [`mastyf-ai`](https://pypi.org/project/mastyf-ai/), which is
free and MIT-licensed.

## Install

```bash
pip install "mastyf-ai[middleware]"   # LangChain 1.0 or later
pip install "mastyf-ai[langchain]"    # LangChain 0.3
pip install "mastyf-ai[langgraph]"    # a LangGraph graph with a ToolNode
```

Python 3.10 or later. The first check downloads Mastyf's free check program for your platform from
the project's [GitHub releases](https://github.com/mastyf-ai/mastyf.ai/releases), runs it only if
its SHA-256 matches the one in the package, and starts it on `127.0.0.1`. It stops when your
program stops.

## LangChain 1.x agents: middleware

Add `MastyfMiddleware` to `create_agent`. Every tool call the agent makes is checked; your tools
stay as they are.

```python
from langchain.agents import create_agent
from mastyf_ai.middleware import MastyfMiddleware

agent = create_agent(
    model="anthropic:claude-sonnet-4-5",
    tools=[search, read_file],
    middleware=[MastyfMiddleware()],
)

agent.invoke({"messages": [{"role": "user", "content": "Summarise the README"}]})
```

It works alongside other middleware. Put it first in the list if you want it to see every call
before any other middleware changes it:

```python
middleware=[MastyfMiddleware(), SummarizationMiddleware(...), HumanInTheLoopMiddleware(...)]
```

### Tools that return a `Command`

A tool's output is treated as untrusted, including a `Command`. Everything it writes is checked:
each message (all fields, not only the text), every other state value, `Send` payloads and
`resume` values. A tool can't take control of the agent:

- It may only add `ToolMessage`s that answer its own call. System, user and AI messages, or an
  answer to a different call, block the result. Each message gets a fresh id, so it can't overwrite
  an earlier message.
- It can't write other state keys (such as `jump_to`, `structured_response` or call counters)
  unless you list them. Values it writes to a listed key are still checked.
- It can't route the graph (`goto` or `Send`) unless you list the target nodes. A `Send` payload
  must be plain data: text, numbers, lists and dicts. Messages, anything shaped like a tool call,
  and objects the middleware can't inspect are blocked, at any depth.

```python
MastyfMiddleware(allowed_goto=["review"], allowed_state_keys=["notes"])
```

Anything the middleware can't check is blocked rather than passed through.

## LangChain 0.3, or only some tools

Wrap the tools instead of adding middleware. Each wrapped tool keeps its name, description and
arguments.

```python
from mastyf_ai.langchain import guard_tools

agent = create_agent(model, tools=guard_tools([search, read_file]) + [get_time])
```

Here `get_time` isn't checked. Use this when you want to choose which tools Mastyf covers.

## LangGraph

Wrap the graph's `ToolNode`:

```python
from langgraph.prebuilt import ToolNode
from mastyf_ai.langgraph import guard_tool_node

graph.add_node("tools", guard_tool_node(ToolNode([search, read_file])))
```

Arguments LangGraph fills from the graph (`InjectedState`, `InjectedStore`, the tool runtime) aren't
checked as model input. Any value the model could have written is.

## What the model sees when something is blocked

A blocked call never runs. The model gets a tool message instead. For example, a call to read
`/etc/passwd`:

```
Blocked by Mastyf (policy: semantic-path-guard).
```

It names the check that stopped the call, never the text that was matched. A blocked result came
from whoever controls that tool, so echoing it back would hand their words to the model. A result
that contains a credential reaches the model with the credential redacted. With the middleware, a
blocked call's tool message has `status="error"`.

## One session per user

Some checks look at a whole run, such as reading a secret file and then sending data out. If one
agent serves many users, give each request its own session so one user's run never affects
another's:

```python
from mastyf_ai import Guard
from mastyf_ai.middleware import MastyfMiddleware

guard = Guard()
agent = create_agent(model, tools=[search, read_file], middleware=[MastyfMiddleware(guard=guard)])

async def handle(request):
    with guard.session(request.id):
        return await agent.ainvoke({"messages": request.messages})
```

## If no check can be made

By default a tool call fails with `MastyfUnavailable` instead of running unchecked. To let calls
through with a warning instead, pass `Guard(on_unavailable="allow")`. An input the check refuses
(for example, one too large to check) is always blocked.

To use a check service you run yourself, such as the Docker image, set `MASTYF_CHECK_URL` and
`MASTYF_CHECK_TOKEN`. To try one call from a terminal:

```bash
mastyf-ai check read_file '{"path": "/etc/passwd"}'
```

## Free and paid

Everything above is free. The paid [Mastyf Shield](https://www.mastyf.ai) app adds model-based
checks on calls your rules allow, and a dashboard of what was blocked. While Shield runs on the same
computer, this library uses it with no change to your code.

## Links

- Package: [mastyf-ai on PyPI](https://pypi.org/project/mastyf-ai/)
- Source: [packages/python-sdk](https://github.com/mastyf-ai/mastyf.ai/tree/main/packages/python-sdk)
- How the checks decide: [README](https://github.com/mastyf-ai/mastyf.ai#how-it-decides)
- Report a security issue: [SECURITY.md](https://github.com/mastyf-ai/mastyf.ai/blob/main/SECURITY.md)
