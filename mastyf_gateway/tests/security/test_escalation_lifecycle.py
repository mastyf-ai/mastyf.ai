"""
Operational Escalation Lifecycle Verification
Verifies that ESCALATE states strictly suspend execution across the gateway core, REST API, and MCP proxy adapters.
"""

import pytest
import asyncio
import json
from pathlib import Path
from mastyf_gateway.models import ToolCallRequest
from mastyf_gateway.policy.schemas import PolicyDocument
from mastyf_gateway.gateway import MastyfGateway
from mastyf_gateway.auditor.aia import MockAIAAuditor
from mastyf_gateway.adapters.mcp import MCPGatewayAdapter

@pytest.fixture
def escalation_gateway():
    fixture_path = Path(__file__).parent.parent / "fixtures" / "policies" / "banking_workspace_policy.json"
    with open(fixture_path, "r") as f:
        policy = PolicyDocument(**json.load(f))
    # Auditor configured to force escalation (e.g. timeout / ambiguity)
    auditor = MockAIAAuditor(default_decision="ESCALATE")
    return MastyfGateway(policy=policy, auditor=auditor)

def test_gateway_execute_async_rejects_escalate(escalation_gateway):
    """Ensures execute_async never invokes the target tool when decision is ESCALATE."""
    async def _run():
        tool_executed = False

        async def dangerous_tool(**kwargs):
            nonlocal tool_executed
            tool_executed = True
            return "EXECUTED"

        req = ToolCallRequest(
            request_id="esc-exec-1",
            session_id="s1",
            principal_id="alice",
            user_intent="Search web",
            tool_name="search_web",
            tool_args={"query": "ambiguous query"}
        )

        res = await escalation_gateway.execute_async(req, dangerous_tool)

        assert res["success"] is False
        assert res["decision"] == "ESCALATE"
        assert res["result"] is None
        assert tool_executed is False, "CRITICAL FLAW: Tool function was executed during ESCALATE state!"

    asyncio.run(_run())

def test_mcp_adapter_rejects_escalate(escalation_gateway):
    """Ensures MCP adapter reports JSON-RPC denial and does not invoke tool executor on ESCALATE."""
    async def _run():
        adapter = MCPGatewayAdapter(escalation_gateway)
        tool_executed = False

        async def mcp_executor(tool_name, tool_args):
            nonlocal tool_executed
            tool_executed = True
            return "MCP_RESULT"

        mcp_payload = {
            "jsonrpc": "2.0",
            "id": "mcp-esc-1",
            "method": "tools/call",
            "params": {
                "name": "search_web",
                "arguments": {"query": "ambiguous request"}
            }
        }

        res = await adapter.handle_mcp_call(mcp_payload, tool_executor=mcp_executor)

        assert "error" in res
        assert res["error"]["code"] == -32000
        assert "ESCALATE" in res["error"]["message"]
        assert tool_executed is False, "CRITICAL FLAW: MCP tool executor ran during ESCALATE state!"

    asyncio.run(_run())
