"""
Mastyf MCP Configuration & Tool Discovery Engine.
Scans standard local environments (Claude Desktop, Cursor, Mastyf Registry)
and introspects tool schemas for conservative policy synthesis.
"""

from __future__ import annotations

import json
import os
import platform
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

from .taxonomy import ToolSecurityClass, classify_tool


@dataclass
class DiscoveredServer:
    """Represents a discovered MCP server declaration."""
    name: str
    source: str  # "Claude Desktop", "Cursor", "Mastyf Registry"
    command: str
    args: List[str] = field(default_factory=list)
    env: Dict[str, str] = field(default_factory=dict)


@dataclass
class DiscoveredTool:
    """Represents a discovered tool with its parameters and security classification."""
    name: str
    description: str
    parameters: Dict[str, Any]
    server_name: str
    security_class: ToolSecurityClass = ToolSecurityClass.UNKNOWN


def get_claude_desktop_config_path() -> Path:
    """Returns the platform-standard path to Claude Desktop configuration."""
    if platform.system() == "Darwin":
        return Path.home() / "Library" / "Application Support" / "Claude" / "claude_desktop_config.json"
    elif platform.system() == "Windows":
        appdata = os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))
        return Path(appdata) / "Claude" / "claude_desktop_config.json"
    else:
        return Path.home() / ".config" / "Claude" / "claude_desktop_config.json"


def get_cursor_config_paths() -> List[Path]:
    """Returns standard search paths for Cursor MCP configurations."""
    return [
        Path.home() / ".cursor" / "mcp.json",
        Path.cwd() / ".cursor" / "mcp.json",
    ]


def get_mastyf_mcp_path() -> Path:
    """Returns local Mastyf MCP registry path."""
    home = Path(os.environ.get("MASTYF_HOME", Path.home() / ".mastyf"))
    return home / "mcp.json"


def parse_mcp_config_file(path: Path, source_name: str) -> List[DiscoveredServer]:
    """Parses an MCP configuration JSON file into DiscoveredServer instances."""
    if not path.exists() or path.stat().st_size == 0:
        return []

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []

    servers: List[DiscoveredServer] = []
    # Standard format: { "mcpServers": { "server_name": { "command": "...", "args": [...] } } }
    mcp_servers = data.get("mcpServers", {})
    for s_name, s_conf in mcp_servers.items():
        cmd = s_conf.get("command", "")
        args = s_conf.get("args", [])
        env = s_conf.get("env", {})
        if cmd:
            servers.append(
                DiscoveredServer(
                    name=s_name,
                    source=source_name,
                    command=cmd,
                    args=args,
                    env=env,
                )
            )

    return servers


def discover_all_servers() -> List[DiscoveredServer]:
    """Discovers all MCP servers across standard local configuration paths."""
    servers: List[DiscoveredServer] = []
    seen_names = set()

    # 1. Claude Desktop
    claude_path = get_claude_desktop_config_path()
    for s in parse_mcp_config_file(claude_path, "Claude Desktop"):
        if s.name not in seen_names:
            seen_names.add(s.name)
            servers.append(s)

    # 2. Cursor
    for cur_path in get_cursor_config_paths():
        for s in parse_mcp_config_file(cur_path, "Cursor"):
            if s.name not in seen_names:
                seen_names.add(s.name)
                servers.append(s)

    # 3. Mastyf Registry
    mastyf_path = get_mastyf_mcp_path()
    for s in parse_mcp_config_file(mastyf_path, "Mastyf Registry"):
        if s.name not in seen_names:
            seen_names.add(s.name)
            servers.append(s)

    return servers


def discover_tools_from_servers(
    servers: List[DiscoveredServer],
    manifest_cache: Optional[Dict[str, List[Dict[str, Any]]]] = None,
) -> List[DiscoveredTool]:
    """
    Introspects tools provided by discovered servers and assigns conservative security classes.
    Uses manifest cache when available or extracts registered schema definitions.
    """
    tools: List[DiscoveredTool] = []
    cache = manifest_cache or {}

    for server in servers:
        server_tools = cache.get(server.name, [])
        for t in server_tools:
            name = t.get("name", "")
            desc = t.get("description", "")
            params = t.get("inputSchema", t.get("parameters", {}))
            sec_class = classify_tool(name, desc, params)
            tools.append(
                DiscoveredTool(
                    name=name,
                    description=desc,
                    parameters=params,
                    server_name=server.name,
                    security_class=sec_class,
                )
            )

    return tools
