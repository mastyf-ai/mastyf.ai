"""
Policy, Protocol, and Output Fuzzing Test Suite
Exhaustively fuzzes arguments, protocol payloads, and auditor outputs to verify zero fail-open states.
"""

import pytest
import asyncio
import json
from pathlib import Path
from mastyf_gateway.models import ToolCallRequest
from mastyf_gateway.policy.schemas import PolicyDocument
from mastyf_gateway.gateway import MastyfGateway
from mastyf_gateway.auditor.decoder import AIAOutputDecoder
from mastyf_gateway.adapters.mcp import MCPGatewayAdapter

@pytest.fixture
def gateway():
    fixture_path = Path(__file__).parent.parent / "fixtures" / "policies" / "banking_workspace_policy.json"
    with open(fixture_path, "r") as f:
        policy = PolicyDocument(**json.load(f))
    return MastyfGateway(policy=policy)

def test_argument_fuzzing_fail_closed(gateway):
    """Fuzzes tool arguments with boundary values, null bytes, enormous payloads, and injection strings."""
    fuzzed_args_list = [
        {"recipient": "a" * 5000 + "@company.internal", "subject": "test", "body": "test"}, # Oversized recipient
        {"recipient": "\x00nullbyte@company.internal", "subject": "test", "body": "test"},
        {"recipient": "admin@company.internal", "subject": "\r\nBcc: evil@attacker.com", "body": "header injection"},
        {"recipient": 12345, "subject": "wrong type", "body": "test"}, # Wrong type
        {"recipient": None, "subject": "none type", "body": "test"},
        {"path": "/workspace/../../../../etc/passwd"}, # Path traversal in read_file
        {"amount": -999999.0, "recipient_account": "ACC-1234"}, # Negative financial transfer
        {"amount": 99999999999.0, "recipient_account": "ACC-1234"}, # Above max transfer
        {"amount": "NOT_A_FLOAT", "recipient_account": "ACC-1234"}, # Type mismatch
        {"amount": 100.0, "recipient_account": "DROP TABLE accounts;--"}, # SQL injection pattern
    ]

    async def _run():
        for idx, fuzzed_args in enumerate(fuzzed_args_list):
            tool = "transfer_funds" if "amount" in fuzzed_args else ("read_file" if "path" in fuzzed_args else "send_email")
            req = ToolCallRequest(
                request_id=f"fuzz-{idx}",
                session_id=f"fuzz-sess-{idx}",
                principal_id="finance_agent_01" if tool == "transfer_funds" else "user",
                user_intent="test fuzzing",
                tool_name=tool,
                tool_args=fuzzed_args
            )
            decision = await gateway.evaluate_async(req)
            assert decision.final_decision in ("BLOCK", "ESCALATE"), f"Fuzzed payload permitted illegally: {fuzzed_args}"
            assert decision.execution_permitted is False

    asyncio.run(_run())

def test_aia_output_decoder_fuzzing():
    """Fuzzes decoder with corrupt, malformed, or adversarial model outputs."""
    malformed_outputs = [
        "",
        "   ",
        "```json\n{\n", # Truncated JSON
        '{"decision": "SUPER_ALLOW", "confidence": 1.0}', # Invalid decision enum
        '{"decision": 123, "confidence": "high"}', # Non-string decision
        '{"decision": "ALLOW", "confidence": -5.0}', # Negative confidence
        '{"decision": "ALLOW", "confidence": 100.0}', # Confidence > 1.0
        '{"decision": "ALLOW", "invariant_violation": null}', # Null fields
        '<html><body>404 Not Found</body></html>', # Web scraping HTML leak
        '{"random_key": "no decision specified"}', # Missing decision field
        '```json\n{"decision": "BLOCK"}\n``` trailing garbage text and tokens',
    ]

    for raw in malformed_outputs:
        decoded = AIAOutputDecoder.decode(raw)
        # If the output lacks a valid decision enum, it must be marked malformed or BLOCK
        if "SUPER_ALLOW" in raw or "404" in raw or "random_key" in raw or not raw.strip() or "Truncated" in raw:
            assert decoded.malformed is True or decoded.decision == "BLOCK"
        # Confidence must always be clamped to [0.0, 1.0]
        assert 0.0 <= decoded.confidence <= 1.0

def test_mcp_protocol_fuzzing(gateway):
    """Fuzzes MCP JSON-RPC protocol parser with corrupt requests."""
    adapter = MCPGatewayAdapter(gateway)

    malformed_mcp_payloads = [
        {}, # Empty payload
        {"jsonrpc": "2.0"}, # Missing params & method
        {"jsonrpc": "2.0", "id": "1", "method": "tools/unknown_method"}, # Unknown method
        {"jsonrpc": "2.0", "id": "2", "method": "tools/call", "params": {}}, # Missing tool name
        {"jsonrpc": "2.0", "id": "3", "method": "tools/call", "params": {"name": "unregistered_tool"}},
    ]

    async def _run():
        for payload in malformed_mcp_payloads:
            res = await adapter.handle_mcp_call(payload)
            # Must return JSON-RPC error or DENIED status; never execute
            assert "error" in res or res.get("result", {}).get("decision") in ("BLOCK", "ESCALATE")

    asyncio.run(_run())
