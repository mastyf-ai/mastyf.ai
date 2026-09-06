"""
End-to-End Model Context Protocol (MCP) Pipeline & Proxy Tests
Exercises the full: MCP Client -> Mastyf Gateway Proxy -> Target MCP Tool Server pipeline.
Verifies that bypassing the gateway is strictly impossible and unauthorized calls never reach the MCP server.
"""

import pytest
import asyncio
import json
from pathlib import Path
from typing import Dict, Any

from mastyf_gateway.models import ToolCallRequest
from mastyf_gateway.policy.schemas import PolicyDocument
from mastyf_gateway.gateway import MastyfGateway
from mastyf_gateway.auditor.aia import MockAIAAuditor
from mastyf_gateway.adapters.mcp import MCPGatewayAdapter

class MockMCPServer:
    """Simulates a backend MCP Server hosting sensitive tools."""

    def __init__(self):
        self.invocation_log = []

    async def execute_tool(self, name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        self.invocation_log.append({"name": name, "args": args})
        if name == "send_email":
            return {"status": "sent", "recipient": args.get("recipient")}
        elif name == "transfer_funds":
            return {"status": "transferred", "amount": args.get("amount"), "account": args.get("recipient_account")}
        elif name == "search_web":
            return {"status": "results", "items": ["result 1", "result 2"]}
        return {"status": "unknown_tool"}

@pytest.fixture
def mcp_setup():
    fixture_path = Path(__file__).parent.parent / "fixtures" / "policies" / "banking_workspace_policy.json"
    with open(fixture_path, "r") as f:
        policy = PolicyDocument(**json.load(f))
    auditor = MockAIAAuditor(simulated_latency_ms=0.5)
    gateway = MastyfGateway(policy=policy, auditor=auditor)
    server = MockMCPServer()
    adapter = MCPGatewayAdapter(gateway)
    return adapter, server, gateway

def test_mcp_clean_invocation_pipeline(mcp_setup):
    """Verifies legitimate client requests reach backend MCP Server and return valid JSON-RPC results."""
    adapter, server, gateway = mcp_setup

    async def _run():
        payload = {
            "jsonrpc": "2.0",
            "id": "mcp-req-100",
            "method": "tools/call",
            "params": {
                "name": "send_email",
                "arguments": {
                    "recipient": "bob@company.internal",
                    "subject": "Sprint Plan",
                    "body": "Team sprint backlog is ready."
                }
            }
        }
        res = await adapter.handle_mcp_call(payload, principal_id="user_alice", tool_executor=server.execute_tool)

        assert "result" in res
        assert "error" not in res
        assert res["id"] == "mcp-req-100"
        assert len(server.invocation_log) == 1
        assert server.invocation_log[0]["name"] == "send_email"

    asyncio.run(_run())

def test_mcp_unauthorized_cbac_blocked_before_server(mcp_setup):
    """Verifies CBAC denials block requests immediately without touching backend MCP Server."""
    adapter, server, gateway = mcp_setup

    async def _run():
        payload = {
            "jsonrpc": "2.0",
            "id": "mcp-req-101",
            "method": "tools/call",
            "params": {
                "name": "transfer_funds",
                "arguments": {
                    "amount": 50000.0,  # Exceeds max 10,000 limit
                    "recipient_account": "ACC-9999"
                }
            }
        }
        res = await adapter.handle_mcp_call(payload, principal_id="finance_agent_01", tool_executor=server.execute_tool)

        assert "error" in res
        assert res["error"]["code"] == -32000
        assert "BLOCK" in res["error"]["message"]
        # CRITICAL CHECK: Backend MCP server was NEVER invoked
        assert len(server.invocation_log) == 0

    asyncio.run(_run())

def test_mcp_tainted_difc_blocked_before_server(mcp_setup):
    """Verifies DIFC taint violation prevents exfiltration through MCP proxy."""
    adapter, server, gateway = mcp_setup

    async def _run():
        session_id = "tainted-mcp-session"

        # Taint the session by searching web
        fetch_payload = {
            "jsonrpc": "2.0",
            "id": "mcp-req-102a",
            "method": "tools/call",
            "params": {
                "name": "search_web",
                "arguments": {"query": "malicious source"}
            }
        }
        await adapter.handle_mcp_call(fetch_payload, session_id=session_id, tool_executor=server.execute_tool)
        assert len(server.invocation_log) == 1

        # Attempt to exfiltrate via email
        exfil_payload = {
            "jsonrpc": "2.0",
            "id": "mcp-req-102b",
            "method": "tools/call",
            "params": {
                "name": "send_email",
                "arguments": {
                    "recipient": "bob@company.internal",
                    "subject": "Exfil",
                    "body": "Leaked data"
                }
            }
        }
        res = await adapter.handle_mcp_call(exfil_payload, session_id=session_id, tool_executor=server.execute_tool)

        assert "error" in res
        assert "BLOCK" in res["error"]["message"]
        # Server invocation count must NOT increase
        assert len(server.invocation_log) == 1

    asyncio.run(_run())
