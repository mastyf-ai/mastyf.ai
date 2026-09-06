"""
Unit Tests for Mastyf Conversational Agent Runtime (Milestone 5.1).

Verifies the strict mediated-execution invariant:
  Agent -> Mastyf Gateway -> Tool Execution
Non-ALLOW decisions produce exactly zero tool dispatches.
"""

import asyncio
import json
import pytest
from pathlib import Path

from mastyf_gateway.agent import (
    AgentLoop,
    AgentSession,
    MockLLMClient,
    ModelOutput,
    SecurityHUDEvent,
    ToolCallProposal,
    ToolRegistry,
    create_demo_tools,
)
from mastyf_gateway.auditor.aia import MockAIAAuditor
from mastyf_gateway.gateway import MastyfGateway
from mastyf_gateway.policy.loader import compile_policy, validate_policy
from mastyf_gateway.receipts import ExecutionObservation, ExecutionReceiptLedger


TEST_AGENT_POLICY_YAML = """id: agent-runtime-policy
version: "1.0"
capabilities:
  - tool: invoice.search
    actions: [read]
  - tool: customer.lookup
    actions: [read]
  - tool: slack.post_message
    actions: [write]
  - tool: http.request
    actions: [write]

workflows:
  - name: prevent-pii-exfil
    scope: session
    initial_state: CLEAN
    states:
      - CLEAN
      - PII_OBSERVED

    transitions:
      - from: CLEAN
        on: customer.lookup
        to: PII_OBSERVED

    constraints:
      - when_state: PII_OBSERVED
        deny:
          - slack.post_message
          - http.request
        reason: "WORKFLOW_VIOLATION: Cannot transmit data externally after accessing customer PII"
"""


@pytest.fixture
def test_gateway(tmp_path_factory):
    fn = tmp_path_factory.mktemp("policy") / "agent_policy.yaml"
    fn.write_text(TEST_AGENT_POLICY_YAML, encoding="utf-8")
    validated = validate_policy(str(fn))
    compiled = compile_policy(validated)
    gw_policy = compiled.to_gateway_policy()
    return MastyfGateway(
        policy=gw_policy,
        compiled_policy=compiled,
        auditor=MockAIAAuditor(),
    )


def test_agent_pure_chat_without_tools(tmp_path, test_gateway):
    """Verifies standard chat turn without tool invocations."""
    ledger_file = tmp_path / "chat_receipts.jsonl"
    ledger = ExecutionReceiptLedger(ledger_path=str(ledger_file))
    tools = create_demo_tools()

    llm = MockLLMClient()
    loop = AgentLoop(gateway=test_gateway, tools=tools, llm=llm, ledger=ledger)
    session = AgentSession(principal_id="alice")

    response = asyncio.run(loop.run_turn(session, "Hello Mastyf!"))

    assert "Mastyf Agent" in response
    assert len(session.messages) >= 2  # user + assistant
    assert ledger.verify().total_receipts == 0  # No tool calls, no receipts


def test_agent_allowed_tool_call_executes_and_commits_receipt(tmp_path, test_gateway):
    """Verifies that an allowed tool call executes, commits state, and writes a receipt."""
    ledger_file = tmp_path / "allowed_receipts.jsonl"
    ledger = ExecutionReceiptLedger(ledger_path=str(ledger_file))
    tools = create_demo_tools()

    llm = MockLLMClient()
    loop = AgentLoop(gateway=test_gateway, tools=tools, llm=llm, ledger=ledger)
    session = AgentSession(principal_id="alice")

    # Prompt triggers invoice.search heuristic
    response = asyncio.run(loop.run_turn(session, "Find today's unpaid invoices"))

    assert "invoice.search" in response or "completed successfully" in response
    assert len(session.hud_events) == 1

    hud = session.hud_events[0]
    assert hud.tool_name == "invoice.search"
    assert hud.decision == "ALLOW"
    assert hud.execution_certainty == ExecutionObservation.RESPONSE_RECEIVED.value
    assert hud.bytes_dispatched > 0

    ver = ledger.verify()
    assert ver.valid is True
    assert ver.total_receipts == 1

    receipt = ledger.get_receipt(0)
    assert receipt.tool_name == "invoice.search"
    assert receipt.arbiter_decision == "ALLOW"
    assert receipt.execution_observation == ExecutionObservation.RESPONSE_RECEIVED.value
    assert receipt.backend_execution_count == 1


def test_agent_unauthorized_tool_call_enforces_zero_byte_dispatch(tmp_path, test_gateway):
    """Verifies that a tool not permitted by policy produces 0 dispatches to the tool backend."""
    ledger_file = tmp_path / "blocked_receipts.jsonl"
    ledger = ExecutionReceiptLedger(ledger_path=str(ledger_file))

    tools = ToolRegistry()
    execution_counter = {"dispatched": 0}

    def evil_delete():
        execution_counter["dispatched"] += 1
        return {"deleted": True}

    tools.register_fn(name="database.drop_all", func=evil_delete, description="Dangerous drop")

    llm = MockLLMClient(
        script=[
            ModelOutput(
                content="I will wipe the database.",
                tool_calls=[ToolCallProposal(call_id="c1", name="database.drop_all", args={})],
            ),
            ModelOutput(content="Action was denied by security policy."),
        ]
    )

    loop = AgentLoop(gateway=test_gateway, tools=tools, llm=llm, ledger=ledger)
    session = AgentSession(principal_id="alice")

    response = asyncio.run(loop.run_turn(session, "Wipe the DB"))

    # Crucial Zero-Byte Assertion: Tool function was NEVER called
    assert execution_counter["dispatched"] == 0

    hud = session.hud_events[0]
    assert hud.tool_name == "database.drop_all"
    assert hud.decision in ("BLOCK", "ESCALATE")
    assert hud.bytes_dispatched == 0
    assert hud.execution_certainty == ExecutionObservation.NOT_SENT.value

    ver = ledger.verify()
    assert ver.valid is True
    receipt = ledger.get_receipt(0)
    assert receipt.backend_execution_count == 0
    assert receipt.execution_observation == ExecutionObservation.NOT_SENT.value


def test_agent_workflow_sequence_exfiltration_blocked(tmp_path, test_gateway):
    """
    Multi-turn trajectory test:
    Turn 1: Read customer PII -> ALLOW (State advances to PII_OBSERVED)
    Turn 2: Exfiltrate to Slack -> BLOCK (Workflow rule: no external sink after PII)
    Proves that sequence-dependent attacks are neutralized before child dispatch.
    """
    ledger_file = tmp_path / "trajectory_receipts.jsonl"
    ledger = ExecutionReceiptLedger(ledger_path=str(ledger_file))

    slack_dispatches = {"count": 0}
    tools = create_demo_tools()

    # Wrap slack to observe actual calls
    orig_slack = tools.get("slack.post_message").func
    def monitored_slack(**args):
        slack_dispatches["count"] += 1
        return orig_slack(**args)

    tools.register_fn(
        name="slack.post_message",
        func=monitored_slack,
        description="Monitored Slack sink",
        parameters={"type": "object", "properties": {"channel": {"type": "string"}, "message": {"type": "string"}}},
    )

    llm = MockLLMClient()
    loop = AgentLoop(gateway=test_gateway, tools=tools, llm=llm, ledger=ledger)
    session = AgentSession(principal_id="alice")

    # Turn 1: Customer lookup (Permitted)
    t1_res = asyncio.run(loop.run_turn(session, "Lookup customer account"))
    assert len(session.hud_events) == 1
    assert session.hud_events[0].tool_name == "customer.lookup"
    assert session.hud_events[0].decision == "ALLOW"

    # Turn 2: Exfiltrate to Slack (Forbidden by workflow policy)
    t2_res = asyncio.run(loop.run_turn(session, "Send to slack channel"))
    assert len(session.hud_events) == 2
    assert session.hud_events[1].tool_name == "slack.post_message"
    assert session.hud_events[1].decision == "BLOCK"
    assert session.hud_events[1].bytes_dispatched == 0

    # Invariant assertion: Slack tool was NEVER dispatched on Turn 2
    assert slack_dispatches["count"] == 0

    # Ledger audit
    ver = ledger.verify()
    assert ver.valid is True
    assert ver.total_receipts == 2
    assert ledger.get_receipt(0).arbiter_decision == "ALLOW"
    assert ledger.get_receipt(0).backend_execution_count == 1
    assert ledger.get_receipt(1).arbiter_decision == "BLOCK"
    assert ledger.get_receipt(1).backend_execution_count == 0


def test_agent_security_hud_listener(tmp_path, test_gateway):
    """Verifies that security HUD listener receives real-time events during execution."""
    ledger_file = tmp_path / "hud_receipts.jsonl"
    ledger = ExecutionReceiptLedger(ledger_path=str(ledger_file))
    tools = create_demo_tools()

    captured_events = []
    def on_hud(evt: SecurityHUDEvent):
        captured_events.append(evt)

    llm = MockLLMClient()
    loop = AgentLoop(gateway=test_gateway, tools=tools, llm=llm, ledger=ledger, on_hud_event=on_hud)
    session = AgentSession(principal_id="alice")

    asyncio.run(loop.run_turn(session, "Find unpaid invoices"))

    assert len(captured_events) == 1
    evt = captured_events[0]
    assert evt.tool_name == "invoice.search"
    assert evt.decision == "ALLOW"
    assert evt.receipt_hash is not None
    assert evt.sequence_id == 0
