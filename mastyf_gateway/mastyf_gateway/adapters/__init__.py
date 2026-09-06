"""
Mastyf Security Gateway External Adapters (REST & MCP)
"""

from .rest import create_rest_app
from .mcp import MCPGatewayAdapter

__all__ = ["create_rest_app", "MCPGatewayAdapter"]
