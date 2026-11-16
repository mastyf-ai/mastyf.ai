"""OpenAI Agents SDK: `guard_function_tools(tools)` checks every call before the tool runs and every
result before the model sees it.

    from mastyf_ai.openai_agents import guard_function_tools
    agent = Agent(name="helper", tools=guard_function_tools([search, read_file]))

Hosted tools (web search, file search, code interpreter) run on OpenAI's side, out of reach of any
local check; they're passed through unchanged with a warning.
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
from typing import Any

from agents import FunctionTool

from .guard import Guard

__all__ = ["guard_function_tools"]

log = logging.getLogger("mastyf_ai")


def _parse(arguments: str) -> Any:
    try:
        return json.loads(arguments) if arguments else {}
    except json.JSONDecodeError:
        return arguments  # checked as {"input": ...}


def _wrap(tool: FunctionTool, guard: Guard) -> FunctionTool:
    original = tool.on_invoke_tool

    async def on_invoke_tool(ctx: Any, arguments: str) -> Any:
        parsed = _parse(arguments)
        verdict = await asyncio.to_thread(guard.check_call, tool.name, parsed)
        if verdict.blocked:
            return verdict.model_message()
        result = await original(ctx, arguments)
        after = await asyncio.to_thread(guard.check_result, tool.name, result, parsed)
        if after.blocked:
            return after.model_message()
        if after.decision == "redact":
            return after.result
        return result

    guarded = copy.copy(tool)  # keeps every setting (and private fields) of the original
    guarded.on_invoke_tool = on_invoke_tool
    return guarded


def guard_function_tools(tools: list[Any], guard: Guard | None = None) -> list[Any]:
    """Wraps each FunctionTool so Mastyf checks it. One Guard (one session) covers the list."""
    g = guard or Guard()
    out = []
    for t in tools:
        name = getattr(t, "name", type(t).__name__)
        if isinstance(t, FunctionTool):
            out.append(_wrap(t, g))
        elif type(t).__name__ in HOSTED:
            log.warning("Mastyf: %s is a hosted tool and is not checked", name)
            out.append(t)
        else:
            # Shell, computer, apply-patch and custom tools run on this machine; passing them
            # through unchecked would be a silent gap, so they're refused.
            raise TypeError(
                f"Mastyf can't check {type(t).__name__} tools ({name}) yet; "
                "add them to the agent outside guard_function_tools() if you accept running them unchecked"
            )
    return out


# Tools that run on OpenAI's side, out of reach of any local check.
HOSTED = {"WebSearchTool", "FileSearchTool", "CodeInterpreterTool", "HostedMCPTool", "ImageGenerationTool", "ToolSearchTool"}
