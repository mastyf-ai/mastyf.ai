"""OpenAI Agents SDK integration for Mastyf AI security proxy."""

from typing import Optional, Dict, Any
from ..client import MastyfProxy, PolicyDecision


class MastyfOpenAIGuard:
    """Guard middleware for OpenAI Agents SDK that evaluates all tool calls through Mastyf."""

    def __init__(self, proxy_url: str = "http://localhost:4000", api_key: Optional[str] = None):
        self._proxy = MastyfProxy(proxy_url) if isinstance(proxy_url, str) else proxy_url
        self._proxy.config.api_key = api_key

    async def before_tool_call(self, tool_name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """Called before every tool execution. Returns {'allowed': bool, 'reason': str}."""
        decision = self._proxy.test_policy(tool_name, args)
        return {
            "allowed": decision.action != "block",
            "reason": decision.reason if decision.action == "block" else "",
        }

    def wrap_tool(self, tool_fn, tool_name: str):
        """Wrap a tool function with policy evaluation."""
        original = tool_fn

        async def wrapped(**kwargs):
            decision = self._proxy.test_policy(tool_name, kwargs)
            if decision.action == "block":
                raise PermissionError(f"Mastyf blocked '{tool_name}': {decision.reason}")
            return await original(**kwargs)

        wrapped.__name__ = tool_name
        return wrapped
