"""LangGraph: `guard_tool_node(ToolNode(tools))` gives a ToolNode whose tools Mastyf checks.

    from mastyf_ai.langgraph import guard_tool_node
    graph.add_node("tools", guard_tool_node(ToolNode([search, read_file])))
"""

from __future__ import annotations

from langgraph.prebuilt import ToolNode

from .guard import Guard
from .langchain import guard_tools

__all__ = ["guard_tool_node"]


def guard_tool_node(node: ToolNode, guard: Guard | None = None) -> ToolNode:
    """A new ToolNode with the same tools, each checked by Mastyf. The original node is unchanged."""
    tools = guard_tools(list(node.tools_by_name.values()), guard=guard)
    return ToolNode(tools, name=node.name, tags=node.tags, handle_tool_errors=node._handle_tool_errors, messages_key=node._messages_key)
