"""LangChain 1.x agents: one line adds Mastyf to every tool call the agent makes.

    from langchain.agents import create_agent
    from mastyf_ai.middleware import MastyfMiddleware

    agent = create_agent(model, tools=[search, read_file], middleware=[MastyfMiddleware()])

Every call is checked before the tool runs and every result before the model reads it. A blocked
call never runs; the model gets "Blocked by Mastyf (...)" as the tool's answer instead. Needs
`pip install "mastyf-ai[middleware]"` (LangChain 1.0 or later). For LangChain 0.3 or a plain
LangGraph `ToolNode`, use `mastyf_ai.langchain.guard_tools` or `mastyf_ai.langgraph.guard_tool_node`.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from langchain.agents.middleware import AgentMiddleware, ToolCallRequest
from langchain_core.messages import ToolMessage
from langgraph.types import Command

from .guard import Guard
from .langchain import _framework_fields, _framework_value, _plain
from .verdict import Verdict

__all__ = ["MastyfMiddleware"]

ToolResult = ToolMessage | Command[Any]


def _checked_arguments(request: ToolCallRequest) -> Any:
    """The call's arguments, minus the objects the framework injects (graph state, store, runtime).

    Same rule as `guard_tools`: a value the model could have written is always checked.
    """
    args = request.tool_call.get("args")
    if not isinstance(args, dict):
        return {"input": args}
    skip = _framework_fields(request.tool) if request.tool is not None else set()
    return {k: v for k, v in args.items() if not _framework_value(v) and (k not in skip or _plain(v))}


def _blocked_message(request: ToolCallRequest, verdict: Verdict) -> ToolMessage:
    return ToolMessage(
        content=verdict.model_message(),
        tool_call_id=request.tool_call.get("id") or "",
        name=request.tool_call.get("name"),
        status="error",
    )


def _apply(message: ToolMessage, verdict: Verdict) -> ToolMessage:
    """The message the model should see, given the verdict on its content."""
    if verdict.blocked:
        return message.model_copy(update={"content": verdict.model_message(), "status": "error"})
    if verdict.decision == "redact":
        redacted = verdict.result
        if not isinstance(redacted, (str, list)):
            redacted = str(redacted)
        return message.model_copy(update={"content": redacted})
    return message


class MastyfMiddleware(AgentMiddleware):
    """Checks every tool call and result of a LangChain 1.x agent with Mastyf.

    One Guard covers the agent. An agent that serves many users should run each request inside
    `with middleware.guard.session(request_id):` so each conversation is checked as its own session.
    """

    def __init__(self, guard: Guard | None = None) -> None:
        super().__init__()
        self.guard = guard or Guard()

    # ── sync ──────────────────────────────────────────────────────────────────

    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolResult],
    ) -> ToolResult:
        name = request.tool_call.get("name") or ""
        checked = _checked_arguments(request)
        verdict = self.guard.check_call(name, checked)
        if verdict.blocked:
            return _blocked_message(request, verdict)
        return self._check_result(name, checked, handler(request))

    def _check_result(self, name: str, checked: Any, result: ToolResult) -> ToolResult:
        def check(message: ToolMessage) -> ToolMessage:
            return _apply(message, self.guard.check_result(name, message.content, checked))

        return _map_tool_messages(result, check)

    # ── async ─────────────────────────────────────────────────────────────────

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolResult]],
    ) -> ToolResult:
        name = request.tool_call.get("name") or ""
        checked = _checked_arguments(request)
        verdict = await asyncio.to_thread(self.guard.check_call, name, checked)
        if verdict.blocked:
            return _blocked_message(request, verdict)
        result = await handler(request)
        # The checks talk to the local check service over HTTP, so they run off the event loop.
        return await asyncio.to_thread(self._check_result, name, checked, result)


def _map_tool_messages(result: ToolResult, fn: Callable[[ToolMessage], ToolMessage]) -> ToolResult:
    """Apply `fn` to the tool's answer, including answers a tool returns inside a `Command`."""
    if isinstance(result, ToolMessage):
        return fn(result)
    if isinstance(result, Command) and isinstance(result.update, dict):
        messages = result.update.get("messages")
        if isinstance(messages, list) and any(isinstance(m, ToolMessage) for m in messages):
            checked = [fn(m) if isinstance(m, ToolMessage) else m for m in messages]
            return Command(
                graph=result.graph,
                update={**result.update, "messages": checked},
                resume=result.resume,
                goto=result.goto,
            )
    return result
