"""
Mastyf Security Gateway Chaos and Resilience Test Suite
Injects simulated component failures, timeouts, memory errors, malformed outputs, and concurrency stress.
"""

import json
import pytest
import asyncio
from pathlib import Path
from mastyf_gateway.models import ToolCallRequest
from mastyf_gateway.policy.schemas import PolicyDocument
from mastyf_gateway.gateway import MastyfGateway
from mastyf_gateway.auditor.aia import MockAIAAuditor

@pytest.fixture
def chaos_gateway():
    fixture_path = Path(__file__).parent.parent / "fixtures" / "policies" / "banking_workspace_policy.json"
    with open(fixture_path, "r") as f:
        policy = PolicyDocument(**json.load(f))
    return policy

def test_chaos_auditor_timeout_escalation(chaos_gateway):
    async def _run():
        auditor = MockAIAAuditor(force_timeout=True)
        gateway = MastyfGateway(policy=chaos_gateway, auditor=auditor)

        req = ToolCallRequest(
            request_id="chaos-timeout-1",
            session_id="s1",
            principal_id="user",
            user_intent="search",
            tool_name="search_web",
            tool_args={"query": "test query"}
        )
        decision = await gateway.evaluate_async(req)
        assert decision.final_decision == "ESCALATE"
        assert decision.execution_permitted is False
        assert decision.reason_code == "AIA_EVALUATION_TIMEOUT"
    asyncio.run(_run())

def test_chaos_auditor_malformed_output(chaos_gateway):
    async def _run():
        auditor = MockAIAAuditor(force_malformed=True)
        gateway = MastyfGateway(policy=chaos_gateway, auditor=auditor)

        req = ToolCallRequest(
            request_id="chaos-malformed-1",
            session_id="s1",
            principal_id="user",
            user_intent="search",
            tool_name="search_web",
            tool_args={"query": "test query"}
        )
        decision = await gateway.evaluate_async(req)
        assert decision.final_decision == "ESCALATE"
        assert decision.execution_permitted is False
        assert decision.reason_code == "AIA_MALFORMED_OUTPUT"
    asyncio.run(_run())

def test_chaos_concurrent_stress_load(chaos_gateway):
    async def _run():
        auditor = MockAIAAuditor(simulated_latency_ms=1.0)
        gateway = MastyfGateway(policy=chaos_gateway, auditor=auditor)

        async def make_req(idx: int):
            # Alternate between safe and attack queries
            is_attack = (idx % 2 == 1)
            req = ToolCallRequest(
                request_id=f"stress-{idx}",
                session_id=f"sess-{idx}",
                principal_id="user",
                user_intent="query",
                tool_name="search_web",
                tool_args={"query": "INJECTION attack" if is_attack else f"valid query {idx}"}
            )
            return await gateway.evaluate_async(req)

        tasks = [make_req(i) for i in range(100)]
        decisions = await asyncio.gather(*tasks)

        assert len(decisions) == 100
        for idx, d in enumerate(decisions):
            if idx % 2 == 1:
                assert d.final_decision == "BLOCK"
                assert d.execution_permitted is False
            else:
                assert d.final_decision == "ALLOW"
                assert d.execution_permitted is True

        # Check metrics
        metrics = gateway.metrics.get_summary()
        assert metrics["total_requests"] == 100
        assert metrics["decisions"]["ALLOW"] == 50
        assert metrics["decisions"]["BLOCK"] == 50
    asyncio.run(_run())

