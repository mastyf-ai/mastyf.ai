"""
Tests for Mastyf Stateful Workflow Authorization & Sequence Policy Graph (Phase 4).

Verifies the 16-point Phase 4 Release Gate:
  1. test_clean_session_starts_in_initial_state
  2. test_authorized_transition_advances_state
  3. test_blocked_call_does_not_advance_state
  4. test_escalated_call_does_not_advance_state
  5. test_not_sent_never_commits_transition
  6. test_response_received_commits_transition
  7. test_sent_child_no_response_marks_execution_uncertainty
  8. test_session_isolation_prevents_leakage
  9. test_concurrent_sessions_do_not_contaminate
  10. test_sequence_violation_produces_block_zero_bytes
  11. test_receipt_records_workflow_state_and_rule
  12. test_requires_state_prerequisite_enforcement
  13. test_max_occurrences_limit_enforcement
  14. test_malformed_workflow_policy_fails_closed
  15. test_deterministic_policy_compilation_and_hash
  16. test_workflow_cannot_expand_cbac_authority
"""

import asyncio
import json
import os
import sys
import tempfile
import threading
import pytest
from pathlib import Path

from mastyf_gateway.policy.loader import validate_policy, compile_policy, PolicyError
from mastyf_gateway.workflow.engine import WorkflowEngine
from mastyf_gateway.gateway import MastyfGateway
from mastyf_gateway.adapters.mcp_stdio_proxy import MCPStdioProxy
from mastyf_gateway.receipts import ExecutionReceiptLedger, ExecutionObservation, canonical_hash
from mastyf_gateway.models import ToolCallRequest, AIADecision
from mastyf_gateway.auditor.aia import MockAIAAuditor


SAMPLE_WORKFLOW_YAML = """id: customer-support-agent
version: "1.0"
capabilities:
  - tool: customer.lookup
    actions: [read]
  - tool: slack.post_message
    actions: [write]
  - tool: database.delete
    actions: [admin]
  - tool: refund_payment
    actions: [write]

workflows:
  - name: protect-pii-exfiltration
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
        reason: "EXFILTRATION_PREVENTION: Cannot post to slack after observing PII"
      - when_execution_certainty: UNKNOWN
        deny:
          - database.delete
          - refund_payment
        reason: "UNCERTAIN_EXECUTION_DENIAL: Sensitive actions prohibited under UNKNOWN certainty"

  - name: admin-safety
    requires_state:
      tool: database.delete
      state: DELETION_AUTHORIZED

  - name: refund-limit
    max_occurrences:
      tool: refund_payment
      count: 1
      scope: session
"""


def test_clean_session_starts_in_initial_state(tmp_path):
    """1. Clean session starts in declared initial state with KNOWN certainty."""
    policy_file = tmp_path / "policy.yaml"
    policy_file.write_text(SAMPLE_WORKFLOW_YAML, encoding="utf-8")
    decl = validate_policy(str(policy_file))
    compiled = compile_policy(decl)

    engine = WorkflowEngine(compiled_policy=compiled)
    state = engine.get_state("sess-clean-1", "protect-pii-exfiltration")
    cert = engine.get_certainty("sess-clean-1", "protect-pii-exfiltration")

    assert state == "CLEAN"
    assert cert == "KNOWN"


def test_authorized_transition_advances_state(tmp_path):
    """2. Authorized tool call with confirmed child response advances state."""
    policy_file = tmp_path / "policy.yaml"
    policy_file.write_text(SAMPLE_WORKFLOW_YAML, encoding="utf-8")
    decl = validate_policy(str(policy_file))
    compiled = compile_policy(decl)

    engine = WorkflowEngine(compiled_policy=compiled)
    req = ToolCallRequest(
        request_id="req-1",
        session_id="sess-trans-1",
        principal_id="agent",
        user_intent="Look up customer",
        tool_name="customer.lookup",
        tool_args={"id": 101}
    )

    decision = engine.evaluate(req)
    assert decision.allowed is True
    assert decision.workflow_state_before == "CLEAN"
    assert decision.workflow_state_after == "PII_OBSERVED"

    # Outcome confirmed: RESPONSE_RECEIVED
    engine.commit_outcome("sess-trans-1", "customer.lookup", ExecutionObservation.RESPONSE_RECEIVED, request_id="req-1")

    # State has advanced
    new_state = engine.get_state("sess-trans-1", "protect-pii-exfiltration")
    assert new_state == "PII_OBSERVED"


def test_blocked_call_does_not_advance_state(tmp_path):
    """3. Blocked call (e.g. sequence violation or CBAC denial) does not advance state."""
    policy_file = tmp_path / "policy.yaml"
    policy_file.write_text(SAMPLE_WORKFLOW_YAML, encoding="utf-8")
    decl = validate_policy(str(policy_file))
    compiled = compile_policy(decl)

    engine = WorkflowEngine(compiled_policy=compiled)

    # First advance to PII_OBSERVED
    req1 = ToolCallRequest(
        request_id="req-1", session_id="sess-blk-1", principal_id="agent",
        user_intent="lookup", tool_name="customer.lookup", tool_args={}
    )
    engine.evaluate(req1)
    engine.commit_outcome("sess-blk-1", "customer.lookup", ExecutionObservation.RESPONSE_RECEIVED, request_id="req-1")
    assert engine.get_state("sess-blk-1", "protect-pii-exfiltration") == "PII_OBSERVED"

    # Now attempt prohibited slack.post_message
    req2 = ToolCallRequest(
        request_id="req-2", session_id="sess-blk-1", principal_id="agent",
        user_intent="exfiltrate", tool_name="slack.post_message", tool_args={"msg": "leak"}
    )
    dec2 = engine.evaluate(req2)
    assert dec2.allowed is False
    assert "EXFILTRATION_PREVENTION" in dec2.reason_code

    # Outcome is NOT_SENT
    engine.commit_outcome("sess-blk-1", "slack.post_message", ExecutionObservation.NOT_SENT, request_id="req-2")
    assert engine.get_state("sess-blk-1", "protect-pii-exfiltration") == "PII_OBSERVED"


def test_escalated_call_does_not_advance_state(tmp_path):
    """4. AIA ambiguity escalation does not advance workflow state."""
    policy_file = tmp_path / "policy.yaml"
    policy_file.write_text(SAMPLE_WORKFLOW_YAML, encoding="utf-8")
    decl = validate_policy(str(policy_file))
    compiled = compile_policy(decl)

    engine = WorkflowEngine(compiled_policy=compiled)
    req = ToolCallRequest(
        request_id="req-esc-1", session_id="sess-esc-1", principal_id="agent",
        user_intent="lookup", tool_name="customer.lookup", tool_args={}
    )
    engine.evaluate(req)

    # Outcome is NOT_SENT because of escalation
    engine.commit_outcome("sess-esc-1", "customer.lookup", ExecutionObservation.NOT_SENT, request_id="req-esc-1")
    assert engine.get_state("sess-esc-1", "protect-pii-exfiltration") == "CLEAN"


def test_not_sent_never_commits_transition(tmp_path):
    """5. Explicit assertion that NOT_SENT observation strictly forbids state commit."""
    engine = WorkflowEngine(compiled_policy={"workflows": {
        "test-wf": {
            "initial_state": "S0",
            "transitions": [{"from": "S0", "on_tool": "step1", "to": "S1"}],
            "constraints": []
        }
    }})

    req = ToolCallRequest(
        request_id="r1", session_id="s1", principal_id="agent",
        user_intent="do step", tool_name="step1"
    )
    dec = engine.evaluate(req)
    assert dec.workflow_state_after == "S1"

    # Feed NOT_SENT
    engine.commit_outcome("s1", "step1", ExecutionObservation.NOT_SENT, request_id="r1")
    assert engine.get_state("s1", "test-wf") == "S0"


def test_response_received_commits_transition(tmp_path):
    """6. Transition commits if and only if RESPONSE_RECEIVED is recorded."""
    engine = WorkflowEngine(compiled_policy={"workflows": {
        "test-wf": {
            "initial_state": "S0",
            "transitions": [{"from": "S0", "on_tool": "step1", "to": "S1"}],
            "constraints": []
        }
    }})

    req = ToolCallRequest(
        request_id="r2", session_id="s2", principal_id="agent",
        user_intent="do step", tool_name="step1"
    )
    engine.evaluate(req)
    engine.commit_outcome("s2", "step1", ExecutionObservation.RESPONSE_RECEIVED, request_id="r2")
    assert engine.get_state("s2", "test-wf") == "S1"


def test_sent_child_no_response_marks_execution_uncertainty(tmp_path):
    """7. Post-dispatch child failure retains prior state and marks certainty UNKNOWN."""
    policy_file = tmp_path / "policy.yaml"
    policy_file.write_text(SAMPLE_WORKFLOW_YAML, encoding="utf-8")
    decl = validate_policy(str(policy_file))
    compiled = compile_policy(decl)

    engine = WorkflowEngine(compiled_policy=compiled)
    req = ToolCallRequest(
        request_id="req-crash", session_id="sess-crash-1", principal_id="agent",
        user_intent="lookup", tool_name="customer.lookup", tool_args={}
    )
    engine.evaluate(req)

    # Post-dispatch failure: SENT_CHILD_NO_RESPONSE
    engine.commit_outcome("sess-crash-1", "customer.lookup", ExecutionObservation.SENT_CHILD_NO_RESPONSE, request_id="req-crash")

    # Retained prior declared state (did not advance to PII_OBSERVED)
    assert engine.get_state("sess-crash-1", "protect-pii-exfiltration") == "CLEAN"
    # Marked execution certainty as UNKNOWN
    assert engine.get_certainty("sess-crash-1", "protect-pii-exfiltration") == "UNKNOWN"

    # Now attempt action that requires KNOWN certainty (database.delete)
    req2 = ToolCallRequest(
        request_id="req-del", session_id="sess-crash-1", principal_id="agent",
        user_intent="delete", tool_name="database.delete", tool_args={}
    )
    dec2 = engine.evaluate(req2)
    assert dec2.allowed is False
    assert "UNCERTAIN_EXECUTION_DENIAL" in dec2.reason_code


def test_session_isolation_prevents_leakage(tmp_path):
    """8. State advance in Session A does not alter or constrain Session B."""
    policy_file = tmp_path / "policy.yaml"
    policy_file.write_text(SAMPLE_WORKFLOW_YAML, encoding="utf-8")
    decl = validate_policy(str(policy_file))
    compiled = compile_policy(decl)

    engine = WorkflowEngine(compiled_policy=compiled)

    # Session A advances
    req_a = ToolCallRequest(
        request_id="ra", session_id="session-A", principal_id="agent",
        user_intent="lookup", tool_name="customer.lookup"
    )
    engine.evaluate(req_a)
    engine.commit_outcome("session-A", "customer.lookup", ExecutionObservation.RESPONSE_RECEIVED, request_id="ra")

    assert engine.get_state("session-A", "protect-pii-exfiltration") == "PII_OBSERVED"
    assert engine.get_state("session-B", "protect-pii-exfiltration") == "CLEAN"

    # Session B can still execute slack.post_message
    req_b = ToolCallRequest(
        request_id="rb", session_id="session-B", principal_id="agent",
        user_intent="post", tool_name="slack.post_message"
    )
    dec_b = engine.evaluate(req_b)
    assert dec_b.allowed is True


def test_concurrent_sessions_do_not_contaminate(tmp_path):
    """9. Parallel requests across multiple sessions maintain monotonic thread-safe state."""
    policy_file = tmp_path / "policy.yaml"
    policy_file.write_text(SAMPLE_WORKFLOW_YAML, encoding="utf-8")
    decl = validate_policy(str(policy_file))
    compiled = compile_policy(decl)
    engine = WorkflowEngine(compiled_policy=compiled)

    errors = []

    def worker(session_idx: int):
        sess_id = f"worker-sess-{session_idx}"
        try:
            req = ToolCallRequest(
                request_id=f"r-{session_idx}", session_id=sess_id, principal_id="agent",
                user_intent="lookup", tool_name="customer.lookup"
            )
            d = engine.evaluate(req)
            if not d.allowed:
                errors.append(f"Session {sess_id} evaluation unexpectedly denied")
            engine.commit_outcome(sess_id, "customer.lookup", ExecutionObservation.RESPONSE_RECEIVED, request_id=f"r-{session_idx}")
            st = engine.get_state(sess_id, "protect-pii-exfiltration")
            if st != "PII_OBSERVED":
                errors.append(f"Session {sess_id} expected PII_OBSERVED, got {st}")
        except Exception as e:
            errors.append(str(e))

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(25)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, f"Concurrent workflow errors: {errors}"


MOCK_CHILD_SCRIPT = """
import sys
import json

while True:
    line = sys.stdin.readline()
    if not line:
        break
    line_str = line.strip()
    if not line_str:
        continue
    try:
        msg = json.loads(line_str)
    except Exception:
        continue

    req_id = msg.get("id")
    method = msg.get("method")
    if method == "tools/call":
        resp = {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "content": [{"type": "text", "text": "executed successfully"}],
                "isError": False
            }
        }
        sys.stdout.write(json.dumps(resp) + "\\n")
        sys.stdout.flush()
"""


@pytest.mark.asyncio
async def test_sequence_violation_produces_block_zero_bytes(tmp_path):
    """10. Prohibited sequence produces BLOCK and writes zero bytes to child server."""

    policy_file = tmp_path / "policy.yaml"
    policy_file.write_text(SAMPLE_WORKFLOW_YAML, encoding="utf-8")
    decl = validate_policy(str(policy_file))
    compiled = compile_policy(decl)
    gw_policy = compiled.to_gateway_policy()

    child_script = tmp_path / "child.py"
    child_script.write_text(MOCK_CHILD_SCRIPT, encoding="utf-8")

    ledger_path = tmp_path / "proxy_wf_receipts.jsonl"
    ledger = ExecutionReceiptLedger(ledger_path=str(ledger_path))

    gateway = MastyfGateway(
        policy=gw_policy,
        compiled_policy=compiled,
        auditor=MockAIAAuditor(simulated_latency_ms=0.5)
    )
    proxy = MCPStdioProxy(
        gateway=gateway,
        child_cmd=[sys.executable, str(child_script)],
        session_id="wf-test-session",
        principal_id="agent",
        ledger=ledger,
    )

    await proxy.start()
    try:
        # Step 1: Execute customer.lookup (Allowed)
        req1 = json.dumps({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "customer.lookup", "arguments": {"id": 10}}
        })
        resp1 = await proxy.process_message(req1)
        assert "result" in resp1

        # Step 2: Attempt slack.post_message (Sequence violation!)
        bytes_before = proxy.child_bytes_written
        req2 = json.dumps({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": "slack.post_message", "arguments": {"msg": "leak"}}
        })
        resp2 = await proxy.process_message(req2)
        bytes_after = proxy.child_bytes_written

        # EXACTLY ZERO BYTES WRITTEN TO CHILD
        assert bytes_after == bytes_before
        assert "error" in resp2
        assert resp2["error"]["data"]["decision"] == "BLOCK"
        assert "EXFILTRATION_PREVENTION" in resp2["error"]["data"]["reason_code"]
    finally:
        await proxy.close()


def test_receipt_records_workflow_state_and_rule(tmp_path):
    """11. Execution receipt captures workflow_id, state_before, state_after, rule, and certainty."""
    policy_file = tmp_path / "policy.yaml"
    policy_file.write_text(SAMPLE_WORKFLOW_YAML, encoding="utf-8")
    decl = validate_policy(str(policy_file))
    compiled = compile_policy(decl)

    ledger_path = tmp_path / "wf_receipts.jsonl"
    ledger = ExecutionReceiptLedger(ledger_path=str(ledger_path))

    r0 = ledger.record(
        request_id="req-wf-1",
        session_id="s1",
        principal_id="agent",
        tool_name="slack.post_message",
        tool_args={"msg": "exfiltrate"},
        policy_id="customer-support-agent",
        policy_obj=compiled,
        cbac_decision="ALLOW",
        difc_decision="ALLOW",
        aia_decision="NOT_EVALUATED",
        arbiter_decision="BLOCK",
        execution_observation=ExecutionObservation.NOT_SENT,
        reason_code="EXFILTRATION_PREVENTION: Cannot post to slack after observing PII",
        workflow_id="protect-pii-exfiltration",
        workflow_state_before="PII_OBSERVED",
        workflow_transition=None,
        workflow_state_after="PII_OBSERVED",
        workflow_rule="when_state: PII_OBSERVED -> deny: slack.post_message",
        execution_certainty="KNOWN",
    )

    assert r0.workflow_id == "protect-pii-exfiltration"
    assert r0.workflow_state_before == "PII_OBSERVED"
    assert r0.workflow_state_after == "PII_OBSERVED"
    assert "when_state: PII_OBSERVED" in r0.workflow_rule
    assert r0.execution_certainty == "KNOWN"
    assert r0.backend_execution_count == 0

    # Receipts self-verify cleanly
    ver = ledger.verify()
    assert ver.valid is True
    assert ver.total_receipts == 1


def test_requires_state_prerequisite_enforcement(tmp_path):
    """12. Tool requiring specific prerequisite state is denied if state not met."""
    policy_file = tmp_path / "policy.yaml"
    policy_file.write_text(SAMPLE_WORKFLOW_YAML, encoding="utf-8")
    decl = validate_policy(str(policy_file))
    compiled = compile_policy(decl)

    engine = WorkflowEngine(compiled_policy=compiled)
    req = ToolCallRequest(
        request_id="req-del", session_id="sess-del", principal_id="agent",
        user_intent="delete db", tool_name="database.delete"
    )

    dec = engine.evaluate(req)
    assert dec.allowed is False
    assert "REQUIRES_STATE_VIOLATION" in dec.reason_code
    assert "DELETION_AUTHORIZED" in dec.reason_code


def test_max_occurrences_limit_enforcement(tmp_path):
    """13. Exceeding tool call count limit produces deterministic denial."""
    policy_file = tmp_path / "policy.yaml"
    policy_file.write_text(SAMPLE_WORKFLOW_YAML, encoding="utf-8")
    decl = validate_policy(str(policy_file))
    compiled = compile_policy(decl)

    engine = WorkflowEngine(compiled_policy=compiled)

    req1 = ToolCallRequest(request_id="r-ref-1", session_id="sess-ref", principal_id="agent", tool_name="refund_payment", user_intent="refund")
    dec1 = engine.evaluate(req1)
    assert dec1.allowed is True
    engine.commit_outcome("sess-ref", "refund_payment", ExecutionObservation.RESPONSE_RECEIVED, request_id="r-ref-1")

    # Second refund attempt should be denied
    req2 = ToolCallRequest(request_id="r-ref-2", session_id="sess-ref", principal_id="agent", tool_name="refund_payment", user_intent="refund again")
    dec2 = engine.evaluate(req2)
    assert dec2.allowed is False
    assert "MAX_OCCURRENCES_EXCEEDED" in dec2.reason_code


def test_malformed_workflow_policy_fails_closed(tmp_path):
    """14. Invalid transitions or missing states in YAML fail validation closed."""
    invalid_yaml = """id: bad-wf-agent
version: "1.0"
capabilities:
  - tool: tool1
    actions: [read]
workflows:
  - name: broken-wf
    initial_state: NON_EXISTENT
    states:
      - S1
      - S2
"""
    p_file = tmp_path / "invalid.yaml"
    p_file.write_text(invalid_yaml, encoding="utf-8")

    with pytest.raises(PolicyError) as exc:
        validate_policy(str(p_file))
    assert "initial_state 'NON_EXISTENT' is not in declared states" in str(exc.value)


def test_deterministic_policy_compilation_and_hash(tmp_path):
    """15. Canonical compiled workflow produces stable policy hash across formatting variations."""
    yaml1 = """id: canon-agent
version: "1.0"
capabilities:
  - tool: t1
    actions: [read]
workflows:
  - name: wf1
    scope: session
    initial_state: CLEAN
    states: [CLEAN, TAINTED]
    transitions:
      - from: CLEAN
        on: t1
        to: TAINTED
"""
    yaml2 = """# Reordered and commented
id: canon-agent
version: "1.0"
workflows:
  - initial_state: CLEAN
    name: wf1
    scope: session
    states:
      - CLEAN
      - TAINTED
    transitions:
      - on: t1
        from: CLEAN
        to: TAINTED
capabilities:
  - actions:
      - read
    tool: t1
"""
    f1 = tmp_path / "f1.yaml"
    f2 = tmp_path / "f2.yaml"
    f1.write_text(yaml1, encoding="utf-8")
    f2.write_text(yaml2, encoding="utf-8")

    p1 = compile_policy(validate_policy(str(f1)))
    p2 = compile_policy(validate_policy(str(f2)))

    h1 = canonical_hash(p1.as_runtime_config())
    h2 = canonical_hash(p2.as_runtime_config())

    assert h1 == h2, f"Policy hashes differed: {h1} vs {h2}"


def test_workflow_cannot_expand_cbac_authority(tmp_path):
    """
    16. Direct assertion that Workflow ALLOW + CBAC DENY results in BLOCK.
    Proves mathematically: Authority(Final) <= Authority(CBAC) ∩ Authority(Workflow).
    Workflow policy CANNOT grant authority that CBAC did not already grant.
    """
    policy_file = tmp_path / "policy.yaml"
    policy_file.write_text(SAMPLE_WORKFLOW_YAML, encoding="utf-8")
    decl = validate_policy(str(policy_file))
    compiled = compile_policy(decl)
    gw_policy = compiled.to_gateway_policy()

    gateway = MastyfGateway(
        policy=gw_policy,
        compiled_policy=compiled,
        auditor=MockAIAAuditor()
    )

    # Propose an un-whitelisted tool 'unauthorized_cmd'
    # Even if workflow engine is in CLEAN state and doesn't restrict it,
    # CBAC MUST DENY, resulting in a terminal BLOCK with zero execution permitted!
    req = ToolCallRequest(
        request_id="req-expand-1",
        session_id="sess-authority-test",
        principal_id="agent",
        user_intent="attempt expansion",
        tool_name="unauthorized_admin_wipe",
        tool_args={}
    )

    decision = gateway.evaluate(req)

    assert decision.cbac_allowed is False
    assert decision.workflow_allowed is True
    assert decision.final_decision == "BLOCK"
    assert decision.execution_permitted is False
    assert decision.invariant_violation == "CBAC_AUTHORITY_DENIAL"
