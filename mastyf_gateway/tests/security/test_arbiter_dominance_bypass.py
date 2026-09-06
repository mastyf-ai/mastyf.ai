"""
Arbiter Dominance and Bypass-Resistance Security Invariant Suite
Formally verifies that downstream tool execution is strictly dominated by:
    FinalDecision == ALLOW  AND  ExecutionPermitted == True

Asserts that no alternate code path, component failure, session reset,
or concurrent interleaving can invoke the downstream backend without
prior arbiter authorization.
"""

import pytest
import asyncio
import json
from pathlib import Path
from typing import Dict, Any, List

from mastyf_gateway.models import ToolCallRequest, GatewayDecision
from mastyf_gateway.policy.schemas import PolicyDocument
from mastyf_gateway.gateway import MastyfGateway
from mastyf_gateway.auditor.aia import MockAIAAuditor
from mastyf_gateway.adapters.mcp import MCPGatewayAdapter
from mastyf_gateway.adapters.rest import create_rest_app


class MonotonicInstrumentedBackend:
    """
    Monotonically increasing instrumented mock backend.
    Records every single downstream tool invocation, order, and payload.
    """
    def __init__(self):
        self.invocation_counter: int = 0
        self.invocations: List[Dict[str, Any]] = []

    async def execute_tool(self, tool_name: str, tool_args: Dict[str, Any]) -> Dict[str, Any]:
        self.invocation_counter += 1
        record = {
            "index": self.invocation_counter,
            "tool": tool_name,
            "args": tool_args
        }
        self.invocations.append(record)
        return {"status": "SUCCESS", "execution_id": f"exec-{self.invocation_counter}"}


@pytest.fixture
def banking_policy() -> PolicyDocument:
    fixture_path = Path(__file__).parent.parent / "fixtures" / "policies" / "banking_workspace_policy.json"
    with open(fixture_path, "r") as f:
        return PolicyDocument(**json.load(f))


def test_arbiter_dominance_across_all_failure_modes(banking_policy):
    """
    Asserts that across all failure modes (CBAC deny, DIFC deny, AIA timeout,
    AIA malformed, missing policy), the backend invocation counter remains UNCHANGED.
    """
    async def _run():
        backend = MonotonicInstrumentedBackend()
        auditor = MockAIAAuditor()
        gateway = MastyfGateway(policy=banking_policy, auditor=auditor)
        adapter = MCPGatewayAdapter(gateway)

        initial_count = backend.invocation_counter
        assert initial_count == 0

        # 1. Baseline: Authorized request should increment counter by exactly 1
        res = await adapter.handle_mcp_call(
            mcp_payload={
                "jsonrpc": "2.0",
                "id": "legit-1",
                "method": "tools/call",
                "params": {
                    "name": "search_web",
                    "arguments": {"query": "Q3 earnings"}
                }
            },
            principal_id="user",
            session_id="clean-session",
            tool_executor=backend.execute_tool
        )
        assert "result" in res
        assert backend.invocation_counter == 1, "Authorized call must reach backend"

        # 2. CBAC Principal Breach -> counter must remain 1
        res = await adapter.handle_mcp_call(
            mcp_payload={
                "jsonrpc": "2.0",
                "id": "cbac-breach",
                "method": "tools/call",
                "params": {
                    "name": "transfer_funds",
                    "arguments": {"amount": 500, "recipient_account": "ACC-1"}
                }
            },
            principal_id="unauthorized_guest",
            session_id="clean-session",
            tool_executor=backend.execute_tool
        )
        assert "error" in res
        assert backend.invocation_counter == 1, "CBAC deny must leave backend untouched"

        # 3. DIFC Taint Sink Violation -> counter must remain 1
        gateway.difc.add_taint("tainted-session", "UNTRUSTED_WEB")
        res = await adapter.handle_mcp_call(
            mcp_payload={
                "jsonrpc": "2.0",
                "id": "difc-breach",
                "method": "tools/call",
                "params": {
                    "name": "send_email",
                    "arguments": {
                        "recipient": "user@company.internal",
                        "subject": "Exfil",
                        "body": "Leak"
                    }
                }
            },
            principal_id="user",
            session_id="tainted-session",
            tool_executor=backend.execute_tool
        )
        assert "error" in res
        assert backend.invocation_counter == 1, "DIFC sink violation must leave backend untouched"

        # 4. AIA Timeout Fault Injection -> counter must remain 1
        auditor_timeout = MockAIAAuditor(force_timeout=True)
        gw_timeout = MastyfGateway(policy=banking_policy, auditor=auditor_timeout)
        adapter_timeout = MCPGatewayAdapter(gw_timeout)
        res = await adapter_timeout.handle_mcp_call(
            mcp_payload={
                "jsonrpc": "2.0",
                "id": "timeout-fault",
                "method": "tools/call",
                "params": {
                    "name": "search_web",
                    "arguments": {"query": "hang forever"}
                }
            },
            principal_id="user",
            session_id="s-timeout",
            tool_executor=backend.execute_tool
        )
        assert "error" in res
        assert backend.invocation_counter == 1, "AIA timeout must fail closed (zero backend calls)"

        # 5. AIA Malformed JSON Fault Injection -> counter must remain 1
        auditor_malformed = MockAIAAuditor(force_malformed=True)
        gw_malformed = MastyfGateway(policy=banking_policy, auditor=auditor_malformed)
        adapter_malformed = MCPGatewayAdapter(gw_malformed)
        res = await adapter_malformed.handle_mcp_call(
            mcp_payload={
                "jsonrpc": "2.0",
                "id": "malformed-fault",
                "method": "tools/call",
                "params": {
                    "name": "search_web",
                    "arguments": {"query": "corrupt json"}
                }
            },
            principal_id="user",
            session_id="s-malformed",
            tool_executor=backend.execute_tool
        )
        assert "error" in res
        assert backend.invocation_counter == 1, "AIA malformed output must fail closed"

        # 6. Missing Policy Document Fault Injection -> counter must remain 1
        gw_no_policy = MastyfGateway(policy=None, auditor=auditor)
        adapter_no_policy = MCPGatewayAdapter(gw_no_policy)
        res = await adapter_no_policy.handle_mcp_call(
            mcp_payload={
                "jsonrpc": "2.0",
                "id": "no-policy-fault",
                "method": "tools/call",
                "params": {
                    "name": "search_web",
                    "arguments": {"query": "missing policy"}
                }
            },
            principal_id="user",
            session_id="s-nopolicy",
            tool_executor=backend.execute_tool
        )
        assert "error" in res
        assert backend.invocation_counter == 1, "Missing policy must fail closed"

    asyncio.run(_run())


def test_session_isolation_and_no_authority_crossover(banking_policy):
    """
    Asserts that concurrent interleaved requests across tainted and authorized sessions
    strictly prevent authority crossover: exactly N_legit calls execute downstream.
    """
    async def _run():
        backend = MonotonicInstrumentedBackend()
        auditor = MockAIAAuditor(simulated_latency_ms=0.2)
        gateway = MastyfGateway(policy=banking_policy, auditor=auditor)
        adapter = MCPGatewayAdapter(gateway)

        num_pairs = 25
        total_requests = num_pairs * 2  # 50 total: 25 authorized, 25 unauthorized/tainted

        # Pre-taint the malicious session
        gateway.difc.add_taint("shared-tainted-session", "UNTRUSTED_WEB")

        async def send_pair(i: int):
            # 1. Malicious / Tainted request
            atk_res = await adapter.handle_mcp_call(
                mcp_payload={
                    "jsonrpc": "2.0",
                    "id": f"atk-{i}",
                    "method": "tools/call",
                    "params": {
                        "name": "send_email",
                        "arguments": {
                            "recipient": "exfil@company.internal",
                            "subject": "Attack",
                            "body": "Leak"
                        }
                    }
                },
                principal_id="user",
                session_id="shared-tainted-session",
                tool_executor=backend.execute_tool
            )

            # 2. Legitimate request in clean isolated session
            legit_res = await adapter.handle_mcp_call(
                mcp_payload={
                    "jsonrpc": "2.0",
                    "id": f"legit-{i}",
                    "method": "tools/call",
                    "params": {
                        "name": "search_web",
                        "arguments": {"query": f"clean search {i}"}
                    }
                },
                principal_id="user",
                session_id=f"clean-session-{i}",
                tool_executor=backend.execute_tool
            )
            return atk_res, legit_res

        tasks = [send_pair(i) for i in range(num_pairs)]
        results = await asyncio.gather(*tasks)

        # Assertions
        for atk, legit in results:
            assert "error" in atk, f"Attack was not blocked: {atk}"
            assert "result" in legit, f"Legitimate call failed: {legit}"

        # Invariant: exactly 25 legitimate requests executed, 0 attacks executed
        assert backend.invocation_counter == num_pairs, (
            f"Expected exactly {num_pairs} backend executions, got {backend.invocation_counter}"
        )

    asyncio.run(_run())
