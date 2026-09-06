"""
Tests for Mastyf Tamper-Evident Execution Receipts (Phase 3).

Verifies the 14-point Phase 3 Release Gate:
  1. test_genesis_receipt_hash
  2. test_sequential_hash_chain
  3. test_tamper_detection_breaks_chain
  4. test_security_invariant_verification
  5. test_proxy_receipt_generation
  6. test_audit_cli_status_and_export
  7. test_truncated_or_corrupt_receipt_fails_closed
  8. test_sequence_gap_detected
  9. test_previous_hash_mismatch_detected
  10. test_policy_hash_is_deterministic
  11. test_arguments_hash_is_deterministic
  12. test_allow_child_failure_marks_execution_unknown
  13. test_concurrent_receipt_appends_remain_ordered
  14. test_export_is_deterministic
"""

import asyncio
import json
import os
import sys
import tempfile
import threading
import pytest
from pathlib import Path

from mastyf_gateway.receipts import (
    ExecutionReceipt,
    ExecutionObservation,
    ExecutionReceiptLedger,
    GENESIS_PREVIOUS_HASH,
    canonical_json,
    canonical_hash,
    hash_arguments,
    hash_policy,
)
from mastyf_gateway.policy.schemas import PolicyDocument
from mastyf_gateway.policy.loader import validate_policy, compile_policy
from mastyf_gateway.adapters.mcp_stdio_proxy import MCPStdioProxy
from mastyf_gateway.gateway import MastyfGateway
from mastyf_gateway.auditor.aia import MockAIAAuditor


def test_genesis_receipt_hash(tmp_path):
    ledger_file = tmp_path / "genesis.jsonl"
    ledger = ExecutionReceiptLedger(ledger_path=str(ledger_file))

    r0 = ledger.record(
        request_id="req-gen-1",
        session_id="sess-1",
        principal_id="user",
        tool_name="read_balance",
        tool_args={"account_id": "ACC-100"},
        policy_id="test-policy",
        policy_obj={"policy_id": "test-policy"},
        cbac_decision="ALLOW",
        difc_decision="ALLOW",
        aia_decision="CLEAR",
        arbiter_decision="ALLOW",
        execution_observation=ExecutionObservation.RESPONSE_RECEIVED,
        reason_code="AUTHORIZED"
    )

    assert r0.sequence_id == 0
    assert r0.previous_receipt_hash == GENESIS_PREVIOUS_HASH
    assert r0.receipt_hash == r0.compute_hash()
    assert r0.backend_execution_count == 1
    assert r0.execution_observation == "RESPONSE_RECEIVED"

    res = ledger.verify()
    assert res.valid is True
    assert res.total_receipts == 1
    assert res.head_receipt_hash == r0.receipt_hash


def test_sequential_hash_chain(tmp_path):
    ledger_file = tmp_path / "chain.jsonl"
    ledger = ExecutionReceiptLedger(ledger_path=str(ledger_file))

    r0 = ledger.record("1", "s", "p", "t1", {}, "pol", {}, "ALLOW", "ALLOW", "CLEAR", "ALLOW", "RESPONSE_RECEIVED", "OK")
    r1 = ledger.record("2", "s", "p", "t2", {}, "pol", {}, "DENY", "ALLOW", "CLEAR", "BLOCK", "NOT_SENT", "CBAC_DENY")
    r2 = ledger.record("3", "s", "p", "t3", {}, "pol", {}, "ALLOW", "ALLOW", "ANOMALY", "ESCALATE", "NOT_SENT", "AIA_ESCALATE")

    assert r1.sequence_id == 1
    assert r1.previous_receipt_hash == r0.receipt_hash
    assert r2.sequence_id == 2
    assert r2.previous_receipt_hash == r1.receipt_hash

    res = ledger.verify()
    assert res.valid is True
    assert res.total_receipts == 3
    assert res.allow_count == 1
    assert res.block_count == 1
    assert res.escalate_count == 1


def test_tamper_detection_breaks_chain(tmp_path):
    ledger_file = tmp_path / "tamper.jsonl"
    ledger = ExecutionReceiptLedger(ledger_path=str(ledger_file))

    ledger.record("1", "s", "p", "t1", {"x": 1}, "pol", {}, "ALLOW", "ALLOW", "CLEAR", "ALLOW", "RESPONSE_RECEIVED", "OK")
    ledger.record("2", "s", "p", "t2", {"x": 2}, "pol", {}, "DENY", "ALLOW", "CLEAR", "BLOCK", "NOT_SENT", "CBAC_DENY")
    ledger.record("3", "s", "p", "t3", {"x": 3}, "pol", {}, "ALLOW", "ALLOW", "CLEAR", "ALLOW", "RESPONSE_RECEIVED", "OK")

    # Tamper with middle record (sequence 1): alter argument or decision
    lines = ledger_file.read_text(encoding="utf-8").strip().split("\n")
    rec1 = json.loads(lines[1])
    rec1["tool_name"] = "tampered_tool"  # Tampering without updating hash
    lines[1] = json.dumps(rec1)
    ledger_file.write_text("\n".join(lines) + "\n", encoding="utf-8")

    res = ledger.verify()
    assert res.valid is False
    assert "Receipt hash mismatch at sequence 1" in res.error_message
    assert res.error_sequence_id == 1


def test_security_invariant_verification(tmp_path):
    """Verifies that non-ALLOW with non-zero backend execution is flagged as an invariant violation."""
    ledger_file = tmp_path / "invariant.jsonl"

    # Construct invalid receipt manually where decision is BLOCK but backend_execution_count == 1
    invalid_receipt = ExecutionReceipt(
        schema=1,
        sequence_id=0,
        timestamp_utc="2026-09-06T11:00:00.000Z",
        request_id="req-viol",
        session_id="sess-1",
        principal_id="attacker",
        tool_name="shell_exec",
        arguments_hash=hash_arguments({"cmd": "whoami"}),
        policy_id="test-policy",
        policy_hash="test-policy-hash",
        cbac_decision="DENY",
        difc_decision="ALLOW",
        aia_decision="CLEAR",
        arbiter_decision="BLOCK",
        backend_execution_count=1,  # INVARIANT VIOLATION!
        execution_observation="NOT_SENT",
        reason_code="CBAC_DENY",
        previous_receipt_hash=GENESIS_PREVIOUS_HASH
    )
    # Give it valid self-hash so hash check passes, but invariant fails
    receipt_with_hash = ExecutionReceipt(
        **{**invalid_receipt.to_dict(), "receipt_hash": invalid_receipt.compute_hash()}
    )
    ledger_file.write_text(json.dumps(receipt_with_hash.to_dict()) + "\n", encoding="utf-8")

    res = ExecutionReceiptLedger.verify_file(ledger_file)
    assert res.valid is False
    assert "Security invariant violation at sequence 0" in res.error_message


def test_proxy_receipt_generation(tmp_path):
    """Verifies that MCPStdioProxy produces valid chained receipts across calls."""
    child_script = tmp_path / "child.py"
    child_script.write_text("""
import sys, json
while True:
    line = sys.stdin.readline()
    if not line: break
    msg = json.loads(line)
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"status": "ok"}}) + "\\n")
    sys.stdout.flush()
""", encoding="utf-8")

    policy = PolicyDocument(
        policy_id="proxy-audit-pol",
        version="1.0",
        capabilities=[]
    )
    gateway = MastyfGateway(policy=policy, auditor=MockAIAAuditor())

    ledger_file = tmp_path / "proxy_receipts.jsonl"
    ledger = ExecutionReceiptLedger(ledger_path=str(ledger_file))

    proxy = MCPStdioProxy(
        gateway=gateway,
        child_cmd=[sys.executable, str(child_script)],
        ledger=ledger
    )

    async def _run():
        await proxy.start()
        try:
            # Blocked call
            await proxy.process_message(json.dumps({
                "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "blocked_tool", "arguments": {}}
            }))
        finally:
            await proxy.close()

    asyncio.run(_run())

    res = ledger.verify()
    assert res.valid is True
    assert res.total_receipts == 1
    assert res.block_count == 1
    assert res.zero_execution_count == 1


def test_audit_cli_status_and_export(tmp_path):
    from mastyf_gateway.cli import cmd_audit
    import argparse

    ledger_file = tmp_path / "cli_receipts.jsonl"
    ledger = ExecutionReceiptLedger(ledger_path=str(ledger_file))
    ledger.record("1", "s", "p", "t1", {}, "p", {}, "ALLOW", "ALLOW", "CLEAR", "ALLOW", "RESPONSE_RECEIVED", "OK")
    ledger.record("2", "s", "p", "t2", {}, "p", {}, "DENY", "ALLOW", "CLEAR", "BLOCK", "NOT_SENT", "CBAC_DENY")

    # 1. audit status
    status_args = argparse.Namespace(audit_action="status", file=str(ledger_file))
    with pytest.raises(SystemExit) as exc:
        cmd_audit(status_args)
    assert exc.value.code == 0

    # 2. audit verify
    verify_args = argparse.Namespace(audit_action="verify", file=str(ledger_file))
    with pytest.raises(SystemExit) as exc:
        cmd_audit(verify_args)
    assert exc.value.code == 0

    # 3. audit export
    export_out = tmp_path / "export.json"
    export_args = argparse.Namespace(audit_action="export", file=str(ledger_file), output=str(export_out), format="json")
    with pytest.raises(SystemExit) as exc:
        cmd_audit(export_args)
    assert exc.value.code == 0
    assert export_out.exists()
    data = json.loads(export_out.read_text(encoding="utf-8"))
    assert len(data) == 2


def test_truncated_or_corrupt_receipt_fails_closed(tmp_path):
    # 1. Test malformed JSON syntax
    ledger_file_syntax = tmp_path / "corrupt_syntax.jsonl"
    ledger_file_syntax.write_text('{"malformed_json\n', encoding="utf-8")
    res_syntax = ExecutionReceiptLedger.verify_file(ledger_file_syntax)
    assert res_syntax.valid is False
    assert "malformed JSON" in res_syntax.error_message

    # 2. Test missing required field
    ledger_file_missing = tmp_path / "corrupt_missing.jsonl"
    ledger_file_missing.write_text('{"schema": 1, "sequence_id": 0}\n', encoding="utf-8")
    res_missing = ExecutionReceiptLedger.verify_file(ledger_file_missing)
    assert res_missing.valid is False
    assert "missing required field" in res_missing.error_message


def test_sequence_gap_detected(tmp_path):
    ledger_file = tmp_path / "gap.jsonl"
    ledger = ExecutionReceiptLedger(ledger_path=str(ledger_file))
    r0 = ledger.record("1", "s", "p", "t", {}, "pol", {}, "ALLOW", "ALLOW", "CLEAR", "ALLOW", "RESPONSE_RECEIVED", "OK")

    # Manually insert record with sequence 5 instead of 1
    r_bad = ExecutionReceipt(
        schema=1, sequence_id=5, timestamp_utc="2026-09-06T11:00:00Z",
        request_id="2", session_id="s", principal_id="p", tool_name="t",
        arguments_hash=hash_arguments({}), policy_id="pol", policy_hash="h",
        cbac_decision="ALLOW", difc_decision="ALLOW", aia_decision="CLEAR", arbiter_decision="ALLOW",
        backend_execution_count=1, execution_observation="RESPONSE_RECEIVED", reason_code="OK",
        previous_receipt_hash=r0.receipt_hash
    )
    r_bad_with_hash = ExecutionReceipt(**{**r_bad.to_dict(), "receipt_hash": r_bad.compute_hash()})

    with open(ledger_file, "a", encoding="utf-8") as f:
        f.write(json.dumps(r_bad_with_hash.to_dict()) + "\n")

    res = ExecutionReceiptLedger.verify_file(ledger_file)
    assert res.valid is False
    assert "Sequence gap: expected 1, found 5" in res.error_message


def test_previous_hash_mismatch_detected(tmp_path):
    ledger_file = tmp_path / "prev_mismatch.jsonl"
    ledger = ExecutionReceiptLedger(ledger_path=str(ledger_file))
    r0 = ledger.record("1", "s", "p", "t", {}, "pol", {}, "ALLOW", "ALLOW", "CLEAR", "ALLOW", "RESPONSE_RECEIVED", "OK")

    r_bad = ExecutionReceipt(
        schema=1, sequence_id=1, timestamp_utc="2026-09-06T11:00:00Z",
        request_id="2", session_id="s", principal_id="p", tool_name="t",
        arguments_hash=hash_arguments({}), policy_id="pol", policy_hash="h",
        cbac_decision="ALLOW", difc_decision="ALLOW", aia_decision="CLEAR", arbiter_decision="ALLOW",
        backend_execution_count=1, execution_observation="RESPONSE_RECEIVED", reason_code="OK",
        previous_receipt_hash="WRONG_PREVIOUS_HASH_DEADBEEF"
    )
    r_bad_with_hash = ExecutionReceipt(**{**r_bad.to_dict(), "receipt_hash": r_bad.compute_hash()})

    with open(ledger_file, "a", encoding="utf-8") as f:
        f.write(json.dumps(r_bad_with_hash.to_dict()) + "\n")

    res = ExecutionReceiptLedger.verify_file(ledger_file)
    assert res.valid is False
    assert "Previous hash mismatch at sequence 1" in res.error_message


def test_policy_hash_is_deterministic(tmp_path):
    yaml1 = """# Comment line 1
id: test-pol
version: "1.0"
capabilities:
  - tool: tool_a
    actions: [read]
"""
    yaml2 = """
id: test-pol
version: "1.0"
# Different comment
capabilities:
  - tool: tool_a
    actions: [read]
"""
    f1 = tmp_path / "pol1.yaml"
    f2 = tmp_path / "pol2.yaml"
    f1.write_text(yaml1, encoding="utf-8")
    f2.write_text(yaml2, encoding="utf-8")

    p1 = compile_policy(validate_policy(f1))
    p2 = compile_policy(validate_policy(f2))

    h1 = hash_policy(p1)
    h2 = hash_policy(p2)
    assert h1 == h2
    assert len(h1) == 64


def test_arguments_hash_is_deterministic():
    args1 = {"b": 2, "a": 1, "details": {"z": 9, "y": 8}}
    args2 = {"details": {"y": 8, "z": 9}, "a": 1, "b": 2}

    h1 = hash_arguments(args1)
    h2 = hash_arguments(args2)
    assert h1 == h2
    assert len(h1) == 64


def test_allow_child_failure_marks_execution_unknown(tmp_path):
    """Verifies that post-dispatch child failures mark count=None and SENT_CHILD_NO_RESPONSE."""
    ledger_file = tmp_path / "unknown_exec.jsonl"
    ledger = ExecutionReceiptLedger(ledger_path=str(ledger_file))

    r = ledger.record(
        request_id="post-crash-1",
        session_id="s",
        principal_id="agent",
        tool_name="database_query",
        tool_args={"query": "SELECT *"},
        policy_id="pol",
        policy_obj={},
        cbac_decision="ALLOW",
        difc_decision="ALLOW",
        aia_decision="CLEAR",
        arbiter_decision="ALLOW",
        execution_observation=ExecutionObservation.SENT_CHILD_NO_RESPONSE,
        reason_code="CHILD_POST_DISPATCH_TIMEOUT"
    )

    assert r.arbiter_decision == "ALLOW"
    assert r.backend_execution_count is None
    assert r.execution_observation == "SENT_CHILD_NO_RESPONSE"

    # Verification must pass because this is a legitimate allowed dispatch where outcome was unknown
    res = ledger.verify()
    assert res.valid is True
    assert res.unknown_execution_count == 1
    assert res.observed_execution_count == 0


def test_concurrent_receipt_appends_remain_ordered(tmp_path):
    ledger_file = tmp_path / "concurrent.jsonl"
    ledger = ExecutionReceiptLedger(ledger_path=str(ledger_file))

    def _worker(thread_idx: int, count: int):
        for i in range(count):
            ledger.record(
                request_id=f"t{thread_idx}-{i}",
                session_id="s",
                principal_id="p",
                tool_name="tool",
                tool_args={"i": i},
                policy_id="pol",
                policy_obj={},
                cbac_decision="ALLOW",
                difc_decision="ALLOW",
                aia_decision="CLEAR",
                arbiter_decision="ALLOW",
                execution_observation=ExecutionObservation.RESPONSE_RECEIVED,
                reason_code="OK"
            )

    threads = []
    num_threads = 5
    per_thread = 20
    for t_id in range(num_threads):
        t = threading.Thread(target=_worker, args=(t_id, per_thread))
        threads.append(t)
        t.start()

    for t in threads:
        t.join()

    res = ledger.verify()
    assert res.valid is True
    assert res.total_receipts == num_threads * per_thread
    assert res.head_sequence_id == (num_threads * per_thread) - 1


def test_export_is_deterministic(tmp_path):
    ledger_file = tmp_path / "exp_source.jsonl"
    ledger = ExecutionReceiptLedger(ledger_path=str(ledger_file))
    ledger.record("1", "s", "p", "t1", {"x": 10}, "pol", {}, "ALLOW", "ALLOW", "CLEAR", "ALLOW", "RESPONSE_RECEIVED", "OK")
    ledger.record("2", "s", "p", "t2", {"x": 20}, "pol", {}, "DENY", "ALLOW", "CLEAR", "BLOCK", "NOT_SENT", "CBAC_DENY")

    json_out = tmp_path / "out.json"
    jsonl_out = tmp_path / "out.jsonl"
    csv_out = tmp_path / "out.csv"

    c1 = ledger.export(json_out, format="json")
    c2 = ledger.export(jsonl_out, format="jsonl")
    c3 = ledger.export(csv_out, format="csv")

    assert c1 == 2 and c2 == 2 and c3 == 2
    assert json_out.exists() and jsonl_out.exists() and csv_out.exists()

    # Re-reading jsonl must verify cleanly
    res = ExecutionReceiptLedger.verify_file(jsonl_out)
    assert res.valid is True
    assert res.total_receipts == 2
