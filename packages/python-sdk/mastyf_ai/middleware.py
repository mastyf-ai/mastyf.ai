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
from langchain_core.messages import BaseMessage, ToolMessage, convert_to_messages
from langgraph.types import Command

from .client import MastyfUnavailable
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


UNCHECKABLE = Verdict(
    decision="block",
    id="uncheckable",
    layer="middleware",
    rule="unchecked-result",
    reason="the tool returned something the middleware could not check",
)


def _apply(message: BaseMessage, verdict: Verdict) -> BaseMessage:
    """The message the model should see, given the verdict on its content."""
    if verdict.blocked:
        update: dict[str, Any] = {"content": verdict.model_message()}
        if isinstance(message, ToolMessage):
            update["status"] = "error"
        return message.model_copy(update=update)
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
        return self._check_result(request, name, checked, handler(request))

    def _check_result(self, request: ToolCallRequest, name: str, checked: Any, result: Any) -> ToolResult:
        """Checks everything the tool sends back. Fails closed: anything it can't check is blocked.

        Only "no check service" (MastyfUnavailable) is left to the Guard's on_unavailable setting.
        """
        try:
            if isinstance(result, ToolMessage):
                return _apply(result, self.guard.check_result(name, result.content, checked))
            if isinstance(result, Command):
                return self._check_command(request, name, checked, result)
        except MastyfUnavailable:
            raise
        except Exception:  # noqa: BLE001 — an error while checking must never let the result through
            pass
        return _blocked_message(request, UNCHECKABLE)

    def _check_command(self, request: ToolCallRequest, name: str, checked: Any, result: Command) -> ToolResult:
        """A tool that returns a Command can write messages and other state the model reads later.

        Every message (in any form LangChain accepts) and every other state value is checked.
        """
        if result.update is None:
            return result  # only goto/resume: nothing the model will read
        update = dict(result.update)  # a dict, or a list of (key, value) pairs
        checked_update: dict[str, Any] = {}

        others = {k: v for k, v in update.items() if k != "messages"}
        if others:
            verdict = self.guard.check_result(name, others, checked)
            if verdict.blocked:
                return _blocked_message(request, verdict)
            if verdict.decision == "redact":
                if not isinstance(verdict.result, dict) or set(verdict.result) != set(others):
                    return _blocked_message(request, UNCHECKABLE)
                others = verdict.result
            checked_update.update(others)

        if "messages" in update:
            raw = update["messages"]
            messages = convert_to_messages(raw if isinstance(raw, list) else [raw])
            checked_update["messages"] = [
                _apply(m, self.guard.check_result(name, m.content, checked)) for m in messages
            ]

        return Command(graph=result.graph, update=checked_update, resume=result.resume, goto=result.goto)

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
        return await asyncio.to_thread(self._check_result, request, name, checked, result)
