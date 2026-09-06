"""
State Isolation and Cross-Session Contamination Security Suite
Verifies that DIFC taint state, session metadata, and principal bounds are strictly isolated across sessions and tenants.
"""

import pytest
import asyncio
import json
from pathlib import Path
from mastyf_gateway.models import ToolCallRequest
from mastyf_gateway.policy.schemas import PolicyDocument
from mastyf_gateway.gateway import MastyfGateway
from mastyf_gateway.difc.taint import SecurityTag
from mastyf_gateway.auditor.aia import MockAIAAuditor

@pytest.fixture
def gateway():
    fixture_path = Path(__file__).parent.parent / "fixtures" / "policies" / "banking_workspace_policy.json"
    with open(fixture_path, "r") as f:
        policy = PolicyDocument(**json.load(f))
    auditor = MockAIAAuditor(simulated_latency_ms=0.5)
    return MastyfGateway(policy=policy, auditor=auditor)

def test_cross_session_taint_isolation(gateway):
    """
    Ensures that when Session A is contaminated with UNTRUSTED_WEB taint,
    Session B (running concurrently or subsequently) remains completely clean.
    """
    async def _run():
        session_a = "tenant-1-session-alpha"
        session_b = "tenant-2-session-beta"

        # Step 1: Poison Session A via search_web untrusted output
        fetch_req_a = ToolCallRequest(
            request_id="iso-1a",
            session_id=session_a,
            principal_id="alice",
            user_intent="Search internet",
            tool_name="search_web",
            tool_args={"query": "external untrusted query"}
        )
        async def dummy_search(**kwargs):
            return "untrusted result"

        res_a = await gateway.execute_async(fetch_req_a, dummy_search)
        assert res_a["success"] is True

        # Verify Session A is now tainted
        taints_a = gateway.difc.get_session_taints(session_a)
        assert SecurityTag.UNTRUSTED_WEB in taints_a

        # Verify Session B has ZERO taint
        taints_b = gateway.difc.get_session_taints(session_b)
        assert len(taints_b) == 0

        # Step 2: Attempt exfiltration sink in Session A -> MUST BE BLOCKED
        exfil_req_a = ToolCallRequest(
            request_id="iso-2a",
            session_id=session_a,
            principal_id="alice",
            user_intent="Send email",
            tool_name="send_email",
            tool_args={
                "recipient": "alice@company.internal",
                "subject": "Status",
                "body": "Sensitive payload"
            }
        )
        decision_a = await gateway.evaluate_async(exfil_req_a)
        assert decision_a.final_decision == "BLOCK"
        assert decision_a.execution_permitted is False
        assert "DIFC_DISALLOWED_FLOW" in decision_a.reason_code

        # Step 3: Attempt the EXACT SAME tool call in Session B -> MUST BE ALLOWED
        exfil_req_b = ToolCallRequest(
            request_id="iso-2b",
            session_id=session_b,
            principal_id="alice",
            user_intent="Send email",
            tool_name="send_email",
            tool_args={
                "recipient": "alice@company.internal",
                "subject": "Status",
                "body": "Sensitive payload"
            }
        )
        decision_b = await gateway.evaluate_async(exfil_req_b)
        assert decision_b.final_decision == "ALLOW"
        assert decision_b.execution_permitted is True

    asyncio.run(_run())

def test_concurrent_interleaved_session_isolation(gateway):
    """
    Fires 50 concurrent requests across 10 distinct sessions (5 clean, 5 tainted)
    to prove race-free state isolation under concurrency.
    """
    async def _run():
        # Pre-taint even numbered sessions
        for i in range(10):
            if i % 2 == 0:
                gateway.difc.add_taint(f"sess-interleaved-{i}", SecurityTag.UNTRUSTED_WEB)

        async def execute_call(idx: int):
            sess_id = f"sess-interleaved-{idx % 10}"
            req = ToolCallRequest(
                request_id=f"concurrent-iso-{idx}",
                session_id=sess_id,
                principal_id="user_test",
                user_intent="Send email",
                tool_name="send_email",
                tool_args={
                    "recipient": "user_test@company.internal",
                    "subject": "Test",
                    "body": "Hello world"
                }
            )
            return await gateway.evaluate_async(req)

        tasks = [execute_call(i) for i in range(50)]
        results = await asyncio.gather(*tasks)

        for idx, decision in enumerate(results):
            sess_idx = idx % 10
            if sess_idx % 2 == 0:
                # Tainted session -> must be BLOCK
                assert decision.final_decision == "BLOCK"
                assert decision.execution_permitted is False
            else:
                # Clean session -> must be ALLOW
                assert decision.final_decision == "ALLOW"
                assert decision.execution_permitted is True

    asyncio.run(_run())
