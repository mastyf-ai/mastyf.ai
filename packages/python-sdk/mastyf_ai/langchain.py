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


def _framework_fields(tool: BaseTool) -> set[str]:
    """Arguments LangGraph fills from the graph (InjectedState, InjectedStore)."""
    try:
        from langgraph.prebuilt import InjectedState, InjectedStore
    except ImportError:
        return set()
    kinds = (InjectedState, InjectedStore)
    out = set()
    for name, info in (getattr(tool.args_schema, "model_fields", None) or {}).items():
        for m in getattr(info, "metadata", ()):
            if isinstance(m, kinds) or (isinstance(m, type) and issubclass(m, kinds)):
                out.add(name)
    return out


def _plain(value: Any) -> bool:
    """A scalar, or a list of scalars: something a model could have written."""
    scalars = (str, bytes, int, float, bool, type(None))
    if isinstance(value, scalars):
        return True
    return isinstance(value, (list, tuple)) and all(isinstance(v, scalars) for v in value)


def _framework_value(value: Any) -> bool:
    try:
        from langgraph.store.base import BaseStore

        if isinstance(value, BaseStore):
            return True
    except ImportError:
        pass
    return type(value).__name__ == "ToolRuntime"


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
        # Every argument the tool gets is checked except the framework's own objects (graph state,
        # store, runtime). Plain LangChain lets a model fill other injected arguments, so those count.
        # In a state/store slot only the graph's own structures (mappings, objects) are skipped;
        # plain values there are checked, since outside a ToolNode the model can fill them.
        skip = _framework_fields(self.inner)
        checked = {k: v for k, v in kwargs.items() if not _framework_value(v) and (k not in skip or _plain(v))}
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
