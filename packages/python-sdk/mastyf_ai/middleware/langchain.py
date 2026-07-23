"""LangChain integration for Mastyf AI security proxy."""

from typing import Optional, Dict, Any, Callable
from ..client import MastyfProxy


class MastyfLangChainGuard:
    """Middleware for LangChain that evaluates tool calls through Mastyf before execution."""

    def __init__(self, proxy_url: str = "http://localhost:4000", api_key: Optional[str] = None):
        self._proxy = MastyfProxy(proxy_url)

    def wrap_tool(self, tool: Any) -> Any:
        """Wrap a LangChain tool with Mastyf policy evaluation."""
        tool_name = getattr(tool, "name", tool.__class__.__name__)
        original_invoke = tool._run if hasattr(tool, "_run") else tool.invoke

        def safe_invoke(*args: Any, **kwargs: Any) -> Any:
            args_dict = kwargs or {}
            if args and len(args) > 0 and isinstance(args[0], str):
                args_dict = {"input": args[0]}
            decision = self._proxy.test_policy(tool_name, args_dict)
            if decision.action == "block":
                raise PermissionError(f"Mastyf blocked '{tool_name}': {decision.reason}")
            return original_invoke(*args, **kwargs)

        if hasattr(tool, "_run"):
            tool._run = safe_invoke
        else:
            tool.invoke = safe_invoke
        return tool

    def create_callback(self) -> Callable:
        """Create a callback for LangChain agent runs."""
        def on_tool_start(tool_name: str, input_str: str) -> None:
            import json
            try:
                args = json.loads(input_str)
            except Exception:
                args = {"input": input_str}
            decision = self._proxy.test_policy(tool_name, args)
            if decision.action == "block":
                raise PermissionError(f"Mastyf blocked '{tool_name}': {decision.reason}")

        return on_tool_start
