"""
Mastyf Discovery Package.
MCP server discovery and conservative tool classification.
"""

from .taxonomy import ToolSecurityClass, classify_tool
from .mcp_discovery import (
    DiscoveredServer,
    DiscoveredTool,
    discover_all_servers,
    discover_tools_from_servers,
)

__all__ = [
    "ToolSecurityClass",
    "classify_tool",
    "DiscoveredServer",
    "DiscoveredTool",
    "discover_all_servers",
    "discover_tools_from_servers",
]
