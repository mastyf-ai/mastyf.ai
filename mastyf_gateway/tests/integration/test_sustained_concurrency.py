"""
Sustained Concurrency and Reliability Assurance Tests
Simulates high-throughput concurrent agent loads and verifies tail latency stability and 100% fail-closed guarantees.
"""

import pytest
import asyncio
import json
import numpy as np
from pathlib import Path

from mastyf_gateway.models import ToolCallRequest
from mastyf_gateway.policy.schemas import PolicyDocument
from mastyf_gateway.gateway import MastyfGateway
from mastyf_gateway.auditor.aia import MockAIAAuditor

@pytest.fixture
def load_gateway():
    fixture_path = Path(__file__).parent.parent / "fixtures" / "policies" / "banking_workspace_policy.json"
    with open(fixture_path, "r") as f:
        policy = PolicyDocument(**json.load(f))
    auditor = MockAIAAuditor(simulated_latency_ms=1.0)
    return MastyfGateway(policy=policy, auditor=auditor)

def test_sustained_concurrent_load_and_p99(load_gateway):
    """Fires 200 concurrent requests (50% attack, 50% clean) and measures tail latency."""
    async def _run():
        num_requests = 200

        async def worker(idx: int):
            is_attack = (idx % 2 == 1)
            req = ToolCallRequest(
                request_id=f"load-req-{idx}",
                session_id=f"load-sess-{idx % 20}", # 20 concurrent sessions
                principal_id="user_test",
                user_intent="test intent",
                tool_name="search_web",
                tool_args={"query": "INJECTION attack payload" if is_attack else f"valid search {idx}"}
            )
            return await load_gateway.evaluate_async(req)

        tasks = [worker(i) for i in range(num_requests)]
        decisions = await asyncio.gather(*tasks)

        assert len(decisions) == num_requests

        # Verify exact correctness: all attacks blocked, all clean allowed
        for idx, d in enumerate(decisions):
            if idx % 2 == 1:
                assert d.final_decision == "BLOCK"
                assert d.execution_permitted is False
            else:
                assert d.final_decision == "ALLOW"
                assert d.execution_permitted is True

        # Check metrics summary
        summary = load_gateway.metrics.get_summary()
        p50 = summary["latency_total_ms"]["p50"]
        p95 = summary["latency_total_ms"]["p95"]
        p99 = summary["latency_total_ms"]["p99"]

        print(f"\n[Load Test Metrics] Total: {num_requests}, P50: {p50:.2f}ms, P95: {p95:.2f}ms, P99: {p99:.2f}ms")
        assert p99 < 100.0, f"P99 latency ({p99}ms) exceeded 100ms budget"

    asyncio.run(_run())
