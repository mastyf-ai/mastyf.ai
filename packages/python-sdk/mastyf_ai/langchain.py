"""LangChain: `guard_tools(tools)` checks every call before the tool runs and every result before
the model sees it.

    from mastyf_ai.langchain import guard_tools
    agent = create_agent(model, tools=guard_tools([search, read_file]))

A blocked call never runs; the model gets "Blocked by Mastyf (...)" as the tool's answer instead.
"""

from __future__ import annotations

import asyncio
from typing import Any

from langchain_core.tools import BaseTool

from .guard import Guard
from .verdict import Verdict

__all__ = ["guard_tools", "GuardedTool"]


def _call_fields(tool: BaseTool) -> set[str] | None:
    """The arguments the model fills in (injected ones like state or config are left out)."""
    schema = tool.tool_call_schema
    if isinstance(schema, dict):
        return set((schema.get("properties") or {}).keys())
    fields = getattr(schema, "model_fields", None)
    return set(fields) if fields is not None else None


def _after(verdict: Verdict, result: Any) -> Any:
    if verdict.blocked:
        return verdict.model_message()
    if verdict.decision == "redact":
        return verdict.result
    return result


class GuardedTool(BaseTool):
    """A tool with Mastyf's checks around it. Same name, description and arguments as the original."""

    inner: BaseTool
    guard: Any

    def _split(self, args: tuple, kwargs: dict) -> tuple[Any, Any]:
        """(what the original tool is called with, what gets checked)."""
        if args and not kwargs:
            value = args[0]
            return value, {"input": value}
        fields = _call_fields(self.inner)
        checked = kwargs if fields is None else {k: v for k, v in kwargs.items() if k in fields}
        return kwargs, checked

    def _run(self, *args: Any, **kwargs: Any) -> Any:
        tool_input, checked = self._split(args, kwargs)
        verdict = self.guard.check_call(self.name, checked)
        if verdict.blocked:
            return verdict.model_message()
        result = self.inner.invoke(tool_input)
        return _after(self.guard.check_result(self.name, result, checked), result)

    async def _arun(self, *args: Any, **kwargs: Any) -> Any:
        tool_input, checked = self._split(args, kwargs)
        verdict = await asyncio.to_thread(self.guard.check_call, self.name, checked)
        if verdict.blocked:
            return verdict.model_message()
        result = await self.inner.ainvoke(tool_input)
        return _after(await asyncio.to_thread(self.guard.check_result, self.name, result, checked), result)


def guard_tools(tools: list[BaseTool], guard: Guard | None = None) -> list[BaseTool]:
    """Wraps each LangChain tool so Mastyf checks it. One Guard (one session) covers the list."""
    g = guard or Guard()
    return [
        GuardedTool(
            name=t.name,
            description=t.description,
            args_schema=t.args_schema,
            return_direct=t.return_direct,
            tags=t.tags,
            metadata=t.metadata,
            inner=t,
            guard=g,
        )
        for t in tools
    ]
