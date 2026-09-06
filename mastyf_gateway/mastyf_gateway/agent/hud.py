"""
Mastyf Security HUD & Transparency Projection (Milestone 5.3).

Architectural Invariant:
    The Security HUD is observational, never authoritative.
    Deterministic Enforcement -> Cryptographic Receipt -> HUD Projection.
    The HUD cannot alter decisions, cannot alter policies, and cannot dispatch tools.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from ..receipts.models import ExecutionReceipt, ExecutionObservation
from ..receipts.ledger import ExecutionReceiptLedger
from .session import SecurityHUDEvent, AgentSession


class SecurityHUDProjection:
    """
    Renders user-visible security telemetry derived strictly from authoritative
    gateway execution receipts.
    """

    @classmethod
    def project_from_receipt(
        cls,
        receipt: ExecutionReceipt,
        ledger: Optional[ExecutionReceiptLedger] = None,
        bytes_dispatched: int = 0,
        rule_violated: Optional[str] = None,
        tool_args: Optional[Dict[str, Any]] = None,
    ) -> SecurityHUDEvent:
        """
        Projects an observational SecurityHUDEvent directly from an authoritative ExecutionReceipt.
        Validates cryptographic hash and ledger integrity.
        """
        # Cryptographic tamper verification
        tamper_detected = False
        computed_hash = receipt.compute_hash()
        if receipt.receipt_hash and receipt.receipt_hash != computed_hash:
            tamper_detected = True

        if ledger is not None and not tamper_detected:
            # Check ledger chain status if available
            status = ledger.get_status()
            if status.chain_integrity == "CORRUPTED":
                tamper_detected = True

        decision = receipt.arbiter_decision
        actual_bytes = bytes_dispatched if decision == "ALLOW" else 0

        # Derive fine-grained authorization projections
        cap_status = "allowed" if receipt.cbac_decision == "ALLOW" else "denied"
        df_status = "clean" if receipt.difc_decision == "ALLOW" else "blocked"
        
        if receipt.workflow_transition:
            wf_status = "valid"
        elif receipt.workflow_rule and ("VIOLATION" in receipt.workflow_rule or "DENY" in receipt.workflow_rule or "EXFILTRATION" in receipt.workflow_rule):
            wf_status = "blocked"
        else:
            wf_status = "valid"

        exec_count = receipt.backend_execution_count if receipt.backend_execution_count is not None else (
            1 if receipt.execution_observation == ExecutionObservation.RESPONSE_RECEIVED.value else 0
        )

        if receipt.execution_certainty == "UNKNOWN" or receipt.execution_observation == ExecutionObservation.SENT_CHILD_NO_RESPONSE.value:
            cert = "UNKNOWN"
        elif receipt.execution_observation:
            cert = receipt.execution_observation
        else:
            cert = receipt.execution_certainty or "NOT_SENT"

        return SecurityHUDEvent(
            timestamp=0.0,
            tool_name=receipt.tool_name,
            tool_args=tool_args or {},
            decision=decision,
            reason_code=receipt.reason_code,
            rule_violated=rule_violated or receipt.workflow_rule,
            bytes_dispatched=actual_bytes,
            receipt_hash=receipt.receipt_hash,
            sequence_id=receipt.sequence_id,
            execution_certainty=cert,
            capability_status=cap_status,
            data_flow_status=df_status,
            workflow_status=wf_status,
            execution_count=exec_count,
            tamper_detected=tamper_detected,
            session_id=receipt.session_id,
            request_id=receipt.request_id,
        )

    @classmethod
    def render_card(
        cls,
        event: SecurityHUDEvent,
        ledger: Optional[ExecutionReceiptLedger] = None,
    ) -> str:
        """
        Renders a formatted plain-text HUD card for an event.
        Guarantees strict visual distinction between ALLOW, BLOCK, and ESCALATE.
        """
        # 1. Check for tamper status
        is_tampered = event.tamper_detected
        if not is_tampered and ledger is not None and event.sequence_id is not None:
            # Check ledger integrity directly
            v_res = ledger.verify()
            if not v_res.valid:
                is_tampered = True

        if is_tampered:
            return (
                f"[🚨 TAMPER DETECTED]\n"
                f"    Receipt #{event.sequence_id} integrity verification failed!\n"
                f"    Warning: Cryptographic hash mismatch or broken chain in ledger.\n"
                f"    Observed tool: {event.tool_name}\n"
                f"    Authority: Gateway Arbiter (Refusing untrusted receipt projection)"
            )

        # 2. ALLOW Decision
        if event.decision == "ALLOW":
            if event.execution_certainty == "UNKNOWN":
                return (
                    f"[?] {event.tool_name}\n"
                    f"    ALLOW (Execution Uncertain)\n"
                    f"    Capability: {event.capability_status}\n"
                    f"    Data flow: {event.data_flow_status}\n"
                    f"    Workflow: {event.workflow_status}\n"
                    f"    Execution: UNKNOWN (Child failed or timed out)\n"
                    f"    Backend dispatch: unconfirmed\n"
                    f"    Receipt: #{event.sequence_id}"
                )
            return (
                f"[✓] {event.tool_name}\n"
                f"    ALLOW\n"
                f"    Capability: {event.capability_status}\n"
                f"    Data flow: {event.data_flow_status}\n"
                f"    Workflow: {event.workflow_status}\n"
                f"    Execution: {event.execution_count}\n"
                f"    Receipt: #{event.sequence_id}"
            )

        # 3. BLOCK Decision
        elif event.decision == "BLOCK":
            rule_line = f"\n    Rule: {event.rule_violated}" if event.rule_violated else ""
            return (
                f"[🛑] {event.tool_name}\n"
                f"    BLOCKED\n"
                f"    Reason: {event.reason_code}{rule_line}\n"
                f"    Backend dispatch: 0 bytes\n"
                f"    Receipt: #{event.sequence_id}"
            )

        # 4. ESCALATE Decision
        elif event.decision == "ESCALATE":
            rule_line = f"\n    Rule: {event.rule_violated}" if event.rule_violated else ""
            return (
                f"[⚠️] {event.tool_name}\n"
                f"    ESCALATE\n"
                f"    Reason: {event.reason_code}{rule_line}\n"
                f"    Backend dispatch: 0 bytes\n"
                f"    Receipt: #{event.sequence_id}\n"
                f"    Note: Operator escalation required (Zero bytes dispatched)"
            )

        # 5. Unknown or Unhandled
        return (
            f"[?] {event.tool_name}\n"
            f"    DECISION: {event.decision}\n"
            f"    Backend dispatch: {event.bytes_dispatched} bytes\n"
            f"    Receipt: #{event.sequence_id}"
        )
