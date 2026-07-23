"""
Mastyf AI — Python SDK for MCP security proxy.

Usage:
    from mastyf_ai import MastyfProxy

    proxy = MastyfProxy("http://localhost:4000")
    proxy.start()

    # The proxy is now protecting all MCP tool calls
"""

from .client import MastyfProxy, MastyfConfig
from .middleware.openai_agents import MastyfOpenAIGuard
from .middleware.langchain import MastyfLangChainGuard
from .scanner import TrustScanner

__version__ = "4.2.0"
__all__ = ["MastyfProxy", "MastyfConfig", "MastyfOpenAIGuard", "MastyfLangChainGuard", "TrustScanner"]
