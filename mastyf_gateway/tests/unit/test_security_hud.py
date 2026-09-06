"""
Unit Tests for Mastyf Security HUD & Transparency Receipts (Milestone 5.3).

Verifies the 10-Point Milestone 5.3 Acceptance Gates:
  1. test_hud_allow_renders_correct_tool_and_decision
  2. test_hud_block_renders_reason_and_zero_bytes
  3. test_hud_escalate_renders_reason_and_zero_bytes
  4. test_hud_receipt_id_matches_ledger
  5. test_hud_cannot_alter_decision
  6. test_hud_cannot_alter_policy
  7. test_concurrent_tool_proposals_remain_correctly_attributed
  8. test_session_isolation
  9. test_post_dispatch_timeout_shows_unknown_execution_certainty
  10. test_tampered_receipt_surfaced_as_invalid
"""

import asyncio
import json
import pytest
from pathlib import Path

from mastyf_gateway.receipts import (
    ExecutionReceipt,
    ExecutionObservation,
    ExecutionReceiptLedger,
    canonical_hash,
)
from mastyf_gateway.gateway import MastyfGateway
from mastyf_gateway.auditor.aia import MockAIAAuditor
from mastyf_gateway.policy.loader import validate_policy, compile_policy
from mastyf_gateway.agent import (
    AgentLoop,
    AgentSession,
    ToolRegistry,
    MockLLMClient,
    ModelOutput,
    ToolCallProposal,
    SecurityHUDEvent,
    SecurityHUDProjection,
)

TEST_HUD_POLICY_YAML = """id: hud-test-policy
version: "1.0"
capabilities:
  - tool: invoice.search
    actions: [read]
  - tool: customer.lookup
    actions: [read]
  - tool: failing.tool
    actions: [execute]
workflows:
  - name: test-flow
    scope: session
    initial_state: CLEAN
    states:
      - CLEAN
      - SENSITIVE
    transitions:
      - from: CLEAN
        on: invoice.search
        to: SENSITIVE
    constraints:
      - when_state: SENSITIVE
        deny:
          - http.request
        reason: "sensitive data → external sink"
"""


@pytest.fixture
def hud_test_gateway(tmp_path_factory):
    fn = tmp_path_factory.mktemp("policy") / "hud_policy.yaml"
    fn.write_text(TEST_HUD_POLICY_YAML, encoding="utf-8")
    validated = validate_policy(str(fn))
    compiled = compile_policy(validated)
    gw_policy = compiled.to_gateway_policy()
    return MastyfGateway(
        policy=gw_policy,
        compiled_policy=compiled,
        auditor=MockAIAAuditor(),
    )


def test_hud_allow_renders_correct_tool_and_decision(tmp_path, hud_test_gateway):
    """1. ALLOW renders correct tool + decision, capability, data flow, workflow, and receipt sequence."""
    ledger = ExecutionReceiptLedger(ledger_path=str(tmp_path / "ledger_allow.jsonl"))
    tools = ToolRegistry()
    tools.register_fn("invoice.search", lambda: {"invoices": ["inv-1"]}, "Search invoices")

    llm = MockLLMClient(
        script=[
            ModelOutput(
                content="Checking invoices...",
                tool_calls=[ToolCallProposal(call_id="c1", name="invoice.search", args={})],
            ),
            ModelOutput(content="Found invoice inv-1."),
        ]
    )

    loop = AgentLoop(gateway=hud_test_gateway, tools=tools, llm=llm, ledger=ledger)
    session = AgentSession(principal_id="alice")

    asyncio.run(loop.run_turn(session, "Search invoices"))

    assert len(session.hud_events) == 1
    event = session.hud_events[0]
    card = SecurityHUDProjection.render_card(event, ledger=ledger)

    assert "[✓] invoice.search" in card
    assert "ALLOW" in card
    assert "Capability: allowed" in card
    assert "Data flow: clean" in card
    assert "Workflow: valid" in card
    assert "Execution: 1" in card
    assert f"Receipt: #{event.sequence_id}" in card


def test_hud_block_renders_reason_and_zero_bytes(tmp_path, hud_test_gateway):
    """2. BLOCK renders reason + 0 bytes backend dispatch."""
    ledger = ExecutionReceiptLedger(ledger_path=str(tmp_path / "ledger_block.jsonl"))
    tools = ToolRegistry()
    dispatch_spy = {"called": False}

    def spy_drop():
        dispatch_spy["called"] = True
        return {"dropped": True}

    tools.register_fn("database.drop_all", spy_drop, "Drop DB")

    llm = MockLLMClient(
        script=[
            ModelOutput(
                content="Wiping...",
                tool_calls=[ToolCallProposal(call_id="c1", name="database.drop_all", args={})],
            ),
            ModelOutput(content="Blocked by gateway."),
        ]
    )

    loop = AgentLoop(gateway=hud_test_gateway, tools=tools, llm=llm, ledger=ledger)
    session = AgentSession(principal_id="alice")

    asyncio.run(loop.run_turn(session, "Drop DB"))

    assert dispatch_spy["called"] is False
    assert len(session.hud_events) == 1
    event = session.hud_events[0]
    card = SecurityHUDProjection.render_card(event, ledger=ledger)

    assert "[🛑] database.drop_all" in card
    assert "BLOCKED" in card
    assert "Reason:" in card
    assert "Backend dispatch: 0 bytes" in card
    assert f"Receipt: #{event.sequence_id}" in card


def test_hud_escalate_renders_reason_and_zero_bytes(tmp_path):
    """3. ESCALATE renders reason + 0 bytes and distinct visual status without implying approved."""
    ledger = ExecutionReceiptLedger(ledger_path=str(tmp_path / "ledger_esc.jsonl"))

    r = ledger.record(
        request_id="req-esc-1",
        session_id="sess-1",
        principal_id="alice",
        tool_name="admin.elevate",
        tool_args={"role": "root"},
        policy_id="test-pol",
        policy_obj={"policy_id": "test-pol"},
        cbac_decision="ALLOW",
        difc_decision="ALLOW",
        aia_decision="SUSPICIOUS",
        arbiter_decision="ESCALATE",
        execution_observation=ExecutionObservation.NOT_SENT,
        reason_code="ELEVATED_PRIVILEGE_REQUIRED",
    )

    event = SecurityHUDProjection.project_from_receipt(
        receipt=r, ledger=ledger, bytes_dispatched=0
    )
    card = SecurityHUDProjection.render_card(event, ledger=ledger)

    assert "[⚠️] admin.elevate" in card
    assert "ESCALATE" in card
    assert "Reason: ELEVATED_PRIVILEGE_REQUIRED" in card
    assert "Backend dispatch: 0 bytes" in card
    assert "Receipt: #0" in card
    assert "Operator escalation required" in card
    # Ensure it does NOT claim to be approved
    assert "Approved" not in card


def test_hud_receipt_id_matches_ledger(tmp_path, hud_test_gateway):
    """4. Receipt ID shown in HUD event matches the authoritative ledger sequence ID."""
    ledger = ExecutionReceiptLedger(ledger_path=str(tmp_path / "ledger_match.jsonl"))
    tools = ToolRegistry()
    tools.register_fn("invoice.search", lambda: {"invoices": []}, "Search invoices")

    llm = MockLLMClient(
        script=[
            ModelOutput(
                content="Querying...",
                tool_calls=[ToolCallProposal(call_id="c1", name="invoice.search", args={})],
            ),
            ModelOutput(content="Done."),
        ]
    )

    loop = AgentLoop(gateway=hud_test_gateway, tools=tools, llm=llm, ledger=ledger)
    session = AgentSession(principal_id="alice")

    asyncio.run(loop.run_turn(session, "Search"))

    event = session.hud_events[0]
    ledger_receipt = ledger.get_receipt(event.sequence_id)

    assert ledger_receipt is not None
    assert ledger_receipt.sequence_id == event.sequence_id
    assert ledger_receipt.receipt_hash == event.receipt_hash
    assert ledger_receipt.tool_name == event.tool_name


def test_hud_cannot_alter_decision(tmp_path, hud_test_gateway):
    """5. HUD is strictly observational and cannot alter arbiter decisions or ledger records."""
    ledger = ExecutionReceiptLedger(ledger_path=str(tmp_path / "ledger_immutable.jsonl"))
    tools = ToolRegistry()
    tools.register_fn("database.drop_all", lambda: {"dropped": True}, "Drop")

    llm = MockLLMClient(
        script=[
            ModelOutput(
                content="Dropping...",
                tool_calls=[ToolCallProposal(call_id="c1", name="database.drop_all", args={})],
            ),
            ModelOutput(content="Done."),
        ]
    )

    loop = AgentLoop(gateway=hud_test_gateway, tools=tools, llm=llm, ledger=ledger)
    session = AgentSession(principal_id="alice")

    asyncio.run(loop.run_turn(session, "Drop"))

    event = session.hud_events[0]
    assert event.decision == "BLOCK"

    # Attempt malicious mutation on HUD event
    event.decision = "ALLOW"
    event.bytes_dispatched = 9999

    # Ledger remains authoritative and untouched
    receipt = ledger.get_receipt(0)
    assert receipt.arbiter_decision == "BLOCK"
    assert receipt.backend_execution_count == 0
    assert receipt.execution_observation == ExecutionObservation.NOT_SENT.value


def test_hud_cannot_alter_policy(hud_test_gateway):
    """6. HUD operations cannot mutate gateway policy definitions."""
    original_caps = [c.tool_name for c in hud_test_gateway.policy.capabilities]
    
    # Render card from arbitrary event
    fake_event = SecurityHUDEvent(
        timestamp=0.0,
        tool_name="unauthorized.tool",
        tool_args={},
        decision="BLOCK",
        reason_code="UNAUTHORIZED",
    )
    SecurityHUDProjection.render_card(fake_event)

    # Policy remains completely invariant
    current_caps = [c.tool_name for c in hud_test_gateway.policy.capabilities]
    assert original_caps == current_caps


def test_concurrent_tool_proposals_remain_correctly_attributed(tmp_path, hud_test_gateway):
    """7. Concurrent / parallel tool proposals remain correctly attributed with distinct receipts."""
    ledger = ExecutionReceiptLedger(ledger_path=str(tmp_path / "ledger_concurrent.jsonl"))
    tools = ToolRegistry()
    tools.register_fn("invoice.search", lambda **kwargs: ["inv"], "Invoices")
    tools.register_fn("customer.lookup", lambda **kwargs: {"name": "Bob"}, "Customer")

    # LLM proposes two tool calls in a single turn
    llm = MockLLMClient(
        script=[
            ModelOutput(
                content="Parallel calls",
                tool_calls=[
                    ToolCallProposal(call_id="c1", name="invoice.search", args={"q": "recent"}),
                    ToolCallProposal(call_id="c2", name="customer.lookup", args={"id": "cust-42"}),
                ],
            ),
            ModelOutput(content="Both finished."),
        ]
    )

    loop = AgentLoop(gateway=hud_test_gateway, tools=tools, llm=llm, ledger=ledger)
    session = AgentSession(principal_id="alice")

    asyncio.run(loop.run_turn(session, "Lookup customer and invoices"))

    assert len(session.hud_events) == 2
    evt1, evt2 = session.hud_events[0], session.hud_events[1]

    assert evt1.tool_name == "invoice.search"
    assert evt1.sequence_id == 0
    assert evt1.request_id != evt2.request_id

    assert evt2.tool_name == "customer.lookup"
    assert evt2.sequence_id == 1

    card1 = SecurityHUDProjection.render_card(evt1, ledger=ledger)
    card2 = SecurityHUDProjection.render_card(evt2, ledger=ledger)

    assert "[✓] invoice.search" in card1
    assert "Receipt: #0" in card1

    assert "[✓] customer.lookup" in card2
    assert "Receipt: #1" in card2


def test_session_isolation(tmp_path, hud_test_gateway):
    """8. Verifies session isolation across concurrent or separate agent sessions."""
    ledger = ExecutionReceiptLedger(ledger_path=str(tmp_path / "ledger_iso.jsonl"))
    tools = ToolRegistry()
    tools.register_fn("invoice.search", lambda: [], "Search")

    llm = MockLLMClient(
        script=[
            ModelOutput(content="1", tool_calls=[ToolCallProposal(call_id="c1", name="invoice.search", args={})]),
            ModelOutput(content="Done 1"),
            ModelOutput(content="2", tool_calls=[ToolCallProposal(call_id="c2", name="invoice.search", args={})]),
            ModelOutput(content="Done 2"),
        ]
    )

    loop = AgentLoop(gateway=hud_test_gateway, tools=tools, llm=llm, ledger=ledger)
    session_a = AgentSession(session_id="sess_A", principal_id="alice")
    session_b = AgentSession(session_id="sess_B", principal_id="bob")

    asyncio.run(loop.run_turn(session_a, "Task A"))
    asyncio.run(loop.run_turn(session_b, "Task B"))

    assert len(session_a.hud_events) == 1
    assert len(session_b.hud_events) == 1

    assert session_a.hud_events[0].session_id == "sess_A"
    assert session_b.hud_events[0].session_id == "sess_B"


def test_post_dispatch_timeout_shows_unknown_execution_certainty(tmp_path, hud_test_gateway):
    """9. Post-dispatch tool timeout or child crash surfaces as UNKNOWN execution certainty."""
    ledger = ExecutionReceiptLedger(ledger_path=str(tmp_path / "ledger_timeout.jsonl"))
    tools = ToolRegistry()

    def crash_tool():
        raise TimeoutError("Child process exceeded 30000ms timeout")

    tools.register_fn("failing.tool", crash_tool, "Failing execution")

    llm = MockLLMClient(
        script=[
            ModelOutput(
                content="Calling failing tool...",
                tool_calls=[ToolCallProposal(call_id="c1", name="failing.tool", args={})],
            ),
            ModelOutput(content="Handled error."),
        ]
    )

    loop = AgentLoop(gateway=hud_test_gateway, tools=tools, llm=llm, ledger=ledger)
    session = AgentSession(principal_id="alice")

    asyncio.run(loop.run_turn(session, "Call failing tool"))

    assert len(session.hud_events) == 1
    event = session.hud_events[0]
    assert event.execution_certainty == "UNKNOWN"

    card = SecurityHUDProjection.render_card(event, ledger=ledger)
    assert "[?]" in card
    assert "ALLOW (Execution Uncertain)" in card
    assert "Execution: UNKNOWN (Child failed or timed out)" in card
    assert "Backend dispatch: unconfirmed" in card


def test_tampered_receipt_surfaced_as_invalid(tmp_path):
    """10. Tampered receipt in ledger is surfaced with tamper alert."""
    ledger_path = tmp_path / "tampered_ledger.jsonl"
    ledger = ExecutionReceiptLedger(ledger_path=str(ledger_path))

    r0 = ledger.record(
        request_id="req-tamper-0",
        session_id="sess-tamper",
        principal_id="user",
        tool_name="invoice.search",
        tool_args={},
        policy_id="test-pol",
        policy_obj={"policy_id": "test-pol"},
        cbac_decision="ALLOW",
        difc_decision="ALLOW",
        aia_decision="CLEAR",
        arbiter_decision="ALLOW",
        execution_observation=ExecutionObservation.RESPONSE_RECEIVED,
        reason_code="AUTHORIZED",
    )

    # Verify initially valid
    event0 = SecurityHUDProjection.project_from_receipt(receipt=r0, ledger=ledger)
    assert event0.tamper_detected is False

    # Simulate adversary tampering directly with recorded ledger line (changing tool name)
    with open(ledger_path, "r", encoding="utf-8") as f:
        data = json.loads(f.readline())
    data["tool_name"] = "malicious.tampered_tool"
    with open(ledger_path, "w", encoding="utf-8") as f:
        f.write(json.dumps(data) + "\n")

    # Reload tampered receipt from ledger
    tampered_receipt = ledger.get_receipt(0)
    assert tampered_receipt is not None

    tampered_event = SecurityHUDProjection.project_from_receipt(
        receipt=tampered_receipt, ledger=ledger
    )
    assert tampered_event.tamper_detected is True

    card = SecurityHUDProjection.render_card(tampered_event, ledger=ledger)
    assert "[🚨 TAMPER DETECTED]" in card
    assert "integrity verification failed" in card
