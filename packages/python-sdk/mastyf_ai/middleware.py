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
from collections.abc import Awaitable, Callable, Iterable
from typing import Any

from langchain.agents.middleware import AgentMiddleware, ToolCallRequest
from langchain_core.messages import AIMessage, BaseMessage, ToolMessage, convert_to_messages
from langgraph.types import Command, Send

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


FORGED_TOOL_CALL = Verdict(
    decision="block",
    id="forged-tool-call",
    layer="middleware",
    rule="tool-injected-tool-call",
    reason="a tool result tried to add tool calls for the agent to run",
)

FORGED_MESSAGE = Verdict(
    decision="block",
    id="forged-message",
    layer="middleware",
    rule="tool-injected-message",
    reason="a tool result tried to add a message that isn't its own tool answer",
)

UNALLOWED_ROUTE = Verdict(
    decision="block",
    id="unallowed-route",
    layer="middleware",
    rule="tool-routed-graph",
    reason="a tool result tried to route the graph to a node not in allowed_goto",
)

# Message fields besides `content` that a tool can fill and the model or graph may read.
_MESSAGE_EXTRA_FIELDS = ("additional_kwargs", "response_metadata", "artifact")

# State keys that steer the agent (create_agent's jump_to). A tool may not set them.
_CONTROL_KEYS = frozenset({"jump_to"})


def _looks_like_tool_call(arg: Any) -> bool:
    """A Send payload shaped like a tool call would make the agent run a call the model never made."""
    if hasattr(arg, "tool_call"):
        return True
    if isinstance(arg, dict):
        return "tool_call" in arg or "tool_calls" in arg or {"name", "args"} <= arg.keys()
    return False


class _Block(Exception):
    """Stops checking a result: the whole result is replaced by a blocked tool message."""

    def __init__(self, verdict: Verdict) -> None:
        super().__init__(verdict.rule)
        self.verdict = verdict


def _carries_tool_calls(message: BaseMessage) -> bool:
    """Tool calls belong to the model. A tool that adds some could make the agent run them."""
    if isinstance(message, AIMessage) and (message.tool_calls or message.invalid_tool_calls):
        return True
    extra = getattr(message, "additional_kwargs", None) or {}
    return bool(extra.get("tool_calls") or extra.get("function_call"))


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

    def __init__(self, guard: Guard | None = None, *, allowed_goto: Iterable[str] = ()) -> None:
        """`allowed_goto`: graph nodes a tool may route to with `Command(goto=...)` or `Send`.

        A tool's output is untrusted, so by default a tool can't change where the graph goes next.
        """
        super().__init__()
        self.guard = guard or Guard()
        self.allowed_goto = frozenset(allowed_goto)

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
                return self._check_message(name, checked, self._own_tool_message(request, name, result))
            if isinstance(result, Command):
                return self._check_command(request, name, checked, result)
        except _Block as stop:
            return _blocked_message(request, stop.verdict)
        except MastyfUnavailable:
            raise
        except Exception:  # noqa: BLE001 — an error while checking must never let the result through
            pass
        return _blocked_message(request, UNCHECKABLE)

    def _check_value(self, name: str, checked: Any, value: Any) -> None:
        """A value that must pass unchanged: blocked or redacted means the whole result is blocked."""
        verdict = self.guard.check_result(name, value, checked)
        if verdict.blocked:
            raise _Block(verdict)
        if verdict.decision == "redact":
            raise _Block(UNCHECKABLE)

    @staticmethod
    def _own_tool_message(request: ToolCallRequest, name: str, message: BaseMessage) -> ToolMessage:
        """A message a tool adds must be a ToolMessage answering this call, re-stamped as this tool's.

        No system, user or AI messages (a tool can't speak for them), no answer to another call,
        and no caller-chosen id (an id already in the conversation would overwrite that message).
        """
        if not isinstance(message, ToolMessage) or message.tool_call_id != request.tool_call.get("id"):
            raise _Block(FORGED_MESSAGE)
        return message.model_copy(update={"id": None, "name": name})

    def _check_message(self, name: str, checked: Any, message: BaseMessage) -> BaseMessage:
        """Checks a whole message: its text, and every other field the model or graph may read."""
        if _carries_tool_calls(message):
            raise _Block(FORGED_TOOL_CALL)
        extras = {f: getattr(message, f) for f in _MESSAGE_EXTRA_FIELDS if getattr(message, f, None)}
        if extras:
            self._check_value(name, checked, extras)
        return _apply(message, self.guard.check_result(name, message.content, checked))

    def _check_command(self, request: ToolCallRequest, name: str, checked: Any, result: Command) -> Command:
        """A Command can write messages and state, route the graph, and resume interrupts.

        A tool is untrusted for control, so:
        - it may only add ToolMessages that answer its own call; each gets a fresh id (it can't
          overwrite an earlier message) and the tool's real name;
        - it may route (goto, Send, jump_to) only to nodes listed in `allowed_goto`, and never send
          a payload shaped like a tool call;
        - every message field, every other state value, each Send payload and the resume value
          are checked as tool output.
        """
        update: dict[str, Any] | None = None
        if result.update is not None:
            items = dict(result.update)  # a dict, or a list of (key, value) pairs
            if _CONTROL_KEYS & items.keys():
                raise _Block(UNALLOWED_ROUTE)
            update = {}
            others = {k: v for k, v in items.items() if k != "messages"}
            if others:
                verdict = self.guard.check_result(name, others, checked)
                if verdict.blocked:
                    raise _Block(verdict)
                if verdict.decision == "redact":
                    if not isinstance(verdict.result, dict) or set(verdict.result) != set(others):
                        raise _Block(UNCHECKABLE)
                    others = verdict.result
                update.update(others)
            if "messages" in items:
                raw = items["messages"]
                messages = convert_to_messages(raw if isinstance(raw, list) else [raw])
                update["messages"] = [
                    self._check_message(name, checked, self._own_tool_message(request, name, m)) for m in messages
                ]

        goto = result.goto
        for target in goto if isinstance(goto, (list, tuple)) else [goto]:
            if target is None:
                continue
            node = target.node if isinstance(target, Send) else target if isinstance(target, str) else None
            if node is None or node not in self.allowed_goto:
                raise _Block(UNALLOWED_ROUTE)
            if isinstance(target, Send):
                if _looks_like_tool_call(target.arg):
                    raise _Block(FORGED_TOOL_CALL)
                self._check_value(name, checked, target.arg)

        if result.resume is not None:
            self._check_value(name, checked, result.resume)

        return Command(graph=result.graph, update=update, resume=result.resume, goto=goto)

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
