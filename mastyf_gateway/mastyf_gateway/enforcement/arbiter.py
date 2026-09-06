"""
Mastyf Security Gateway Decision Arbiter
Implements the formal reference-monitor state machine and authority monotonicity invariant.
"""

from typing import Optional
from ..models import (
    ToolCallRequest,
    CBACDecision,
    DIFCDecision,
    AIADecision,
    WorkflowDecision,
    GatewayDecision,
    DecisionType
)

class DecisionArbiter:
    """
    Formal Decision Arbiter implementing:
    1. Authority Monotonicity: Authority(Final) <= Authority(CBAC) & Authority(DIFC) & Authority(Workflow)
    2. Execution Rule: Final == ALLOW => CBAC == ALLOW & DIFC == ALLOW & Workflow == ALLOW & AIA == ALLOW
    3. ESCALATE / BLOCK terminal safety: Neither state permits tool execution.
    """

    def arbitrate(
        self,
        req: ToolCallRequest,
        cbac_res: CBACDecision,
        difc_res: DIFCDecision,
        aia_res: Optional[AIADecision] = None,
        workflow_res: Optional[WorkflowDecision] = None,
        total_latency_ms: float = 0.0
    ) -> GatewayDecision:
        """
        Synthesizes component decisions into an immutable GatewayDecision.
        """
        wf_allowed = workflow_res.allowed if workflow_res else True
        wf_id = workflow_res.workflow_id if workflow_res else None
        wf_before = workflow_res.workflow_state_before if workflow_res else None
        wf_trans = workflow_res.workflow_transition if workflow_res else None
        wf_after = workflow_res.workflow_state_after if workflow_res else None
        wf_rule = workflow_res.workflow_rule if workflow_res else None
        wf_cert = workflow_res.execution_certainty if workflow_res else "KNOWN"
        wf_lat = workflow_res.latency_ms if workflow_res else 0.0

        # Step 1: Strict CBAC boundary enforcement
        if not cbac_res.allowed:
            return GatewayDecision(
                request_id=req.request_id,
                timestamp_utc=req.timestamp_utc,
                tool_name=req.tool_name,
                arguments_hash=req.arguments_hash(),
                final_decision="BLOCK",
                execution_permitted=False,
                reason_code=cbac_res.reason_code,
                policy_id=cbac_res.policy_id,
                cbac_allowed=False,
                difc_allowed=difc_res.allowed,
                workflow_allowed=wf_allowed,
                workflow_id=wf_id,
                workflow_state_before=wf_before,
                workflow_transition=wf_trans,
                workflow_state_after=wf_after,
                workflow_rule=wf_rule,
                execution_certainty=wf_cert,
                aia_evaluated=False,
                aia_decision=None,
                invariant_violation="CBAC_AUTHORITY_DENIAL",
                total_latency_ms=total_latency_ms,
                cbac_latency_ms=cbac_res.latency_ms,
                difc_latency_ms=difc_res.latency_ms,
                workflow_latency_ms=wf_lat,
                aia_latency_ms=0.0
            )

        # Step 2: Strict DIFC information flow enforcement
        if not difc_res.allowed:
            return GatewayDecision(
                request_id=req.request_id,
                timestamp_utc=req.timestamp_utc,
                tool_name=req.tool_name,
                arguments_hash=req.arguments_hash(),
                final_decision="BLOCK",
                execution_permitted=False,
                reason_code=difc_res.reason_code,
                policy_id=cbac_res.policy_id,
                cbac_allowed=True,
                difc_allowed=False,
                workflow_allowed=wf_allowed,
                workflow_id=wf_id,
                workflow_state_before=wf_before,
                workflow_transition=wf_trans,
                workflow_state_after=wf_after,
                workflow_rule=wf_rule,
                execution_certainty=wf_cert,
                aia_evaluated=False,
                aia_decision=None,
                invariant_violation="DIFC_FLOW_VIOLATION",
                total_latency_ms=total_latency_ms,
                cbac_latency_ms=cbac_res.latency_ms,
                difc_latency_ms=difc_res.latency_ms,
                workflow_latency_ms=wf_lat,
                aia_latency_ms=0.0
            )

        # Step 3: Strict Workflow state & sequence authorization enforcement
        if workflow_res is not None and not workflow_res.allowed:
            return GatewayDecision(
                request_id=req.request_id,
                timestamp_utc=req.timestamp_utc,
                tool_name=req.tool_name,
                arguments_hash=req.arguments_hash(),
                final_decision="BLOCK",
                execution_permitted=False,
                reason_code=workflow_res.reason_code,
                policy_id=cbac_res.policy_id,
                cbac_allowed=True,
                difc_allowed=True,
                workflow_allowed=False,
                workflow_id=wf_id,
                workflow_state_before=wf_before,
                workflow_transition=wf_trans,
                workflow_state_after=wf_after,
                workflow_rule=wf_rule,
                execution_certainty=wf_cert,
                aia_evaluated=False,
                aia_decision=None,
                invariant_violation="WORKFLOW_SEQUENCE_VIOLATION",
                total_latency_ms=total_latency_ms,
                cbac_latency_ms=cbac_res.latency_ms,
                difc_latency_ms=difc_res.latency_ms,
                workflow_latency_ms=wf_lat,
                aia_latency_ms=0.0
            )

        # Step 4: Pure deterministic path (no AIA required / configured)
        if aia_res is None:
            return GatewayDecision(
                request_id=req.request_id,
                timestamp_utc=req.timestamp_utc,
                tool_name=req.tool_name,
                arguments_hash=req.arguments_hash(),
                final_decision="ALLOW",
                execution_permitted=True,
                reason_code="DETERMINISTIC_PASS",
                policy_id=cbac_res.policy_id,
                cbac_allowed=True,
                difc_allowed=True,
                workflow_allowed=True,
                workflow_id=wf_id,
                workflow_state_before=wf_before,
                workflow_transition=wf_trans,
                workflow_state_after=wf_after,
                workflow_rule=wf_rule,
                execution_certainty=wf_cert,
                aia_evaluated=False,
                aia_decision=None,
                invariant_violation="none",
                total_latency_ms=total_latency_ms,
                cbac_latency_ms=cbac_res.latency_ms,
                difc_latency_ms=difc_res.latency_ms,
                workflow_latency_ms=wf_lat,
                aia_latency_ms=0.0
            )

        # Step 4: AIA neural auditor resolution
        aia_lat = aia_res.latency_ms
        if aia_res.timed_out:
            return GatewayDecision(
                request_id=req.request_id,
                timestamp_utc=req.timestamp_utc,
                tool_name=req.tool_name,
                arguments_hash=req.arguments_hash(),
                final_decision="ESCALATE",
                execution_permitted=False,
                reason_code="AIA_EVALUATION_TIMEOUT",
                policy_id=cbac_res.policy_id,
                cbac_allowed=True,
                difc_allowed=True,
                workflow_allowed=True,
                workflow_id=wf_id,
                workflow_state_before=wf_before,
                workflow_transition=wf_trans,
                workflow_state_after=wf_after,
                workflow_rule=wf_rule,
                execution_certainty=wf_cert,
                aia_evaluated=True,
                aia_decision="ESCALATE",
                invariant_violation="AUDITOR_TIMEOUT",
                total_latency_ms=total_latency_ms,
                cbac_latency_ms=cbac_res.latency_ms,
                difc_latency_ms=difc_res.latency_ms,
                workflow_latency_ms=wf_lat,
                aia_latency_ms=aia_lat,
                model_revision=aia_res.model_revision
            )

        if aia_res.malformed:
            return GatewayDecision(
                request_id=req.request_id,
                timestamp_utc=req.timestamp_utc,
                tool_name=req.tool_name,
                arguments_hash=req.arguments_hash(),
                final_decision="ESCALATE",
                execution_permitted=False,
                reason_code="AIA_MALFORMED_OUTPUT",
                policy_id=cbac_res.policy_id,
                cbac_allowed=True,
                difc_allowed=True,
                workflow_allowed=True,
                workflow_id=wf_id,
                workflow_state_before=wf_before,
                workflow_transition=wf_trans,
                workflow_state_after=wf_after,
                workflow_rule=wf_rule,
                execution_certainty=wf_cert,
                aia_evaluated=True,
                aia_decision="ESCALATE",
                invariant_violation="AUDITOR_MALFORMED_SCHEMA",
                total_latency_ms=total_latency_ms,
                cbac_latency_ms=cbac_res.latency_ms,
                difc_latency_ms=difc_res.latency_ms,
                workflow_latency_ms=wf_lat,
                aia_latency_ms=aia_lat,
                model_revision=aia_res.model_revision
            )

        if aia_res.decision == "BLOCK":
            return GatewayDecision(
                request_id=req.request_id,
                timestamp_utc=req.timestamp_utc,
                tool_name=req.tool_name,
                arguments_hash=req.arguments_hash(),
                final_decision="BLOCK",
                execution_permitted=False,
                reason_code=aia_res.reason_code or "AIA_INJECTION_DETECTED",
                policy_id=cbac_res.policy_id,
                cbac_allowed=True,
                difc_allowed=True,
                workflow_allowed=True,
                workflow_id=wf_id,
                workflow_state_before=wf_before,
                workflow_transition=wf_trans,
                workflow_state_after=wf_after,
                workflow_rule=wf_rule,
                execution_certainty=wf_cert,
                aia_evaluated=True,
                aia_decision="BLOCK",
                invariant_violation=aia_res.invariant_violation or "NEURAL_AUDITOR_BLOCK",
                total_latency_ms=total_latency_ms,
                cbac_latency_ms=cbac_res.latency_ms,
                difc_latency_ms=difc_res.latency_ms,
                workflow_latency_ms=wf_lat,
                aia_latency_ms=aia_lat,
                model_revision=aia_res.model_revision
            )

        if aia_res.decision == "ESCALATE":
            return GatewayDecision(
                request_id=req.request_id,
                timestamp_utc=req.timestamp_utc,
                tool_name=req.tool_name,
                arguments_hash=req.arguments_hash(),
                final_decision="ESCALATE",
                execution_permitted=False,
                reason_code=aia_res.reason_code or "AIA_ESCALATION_REQUIRED",
                policy_id=cbac_res.policy_id,
                cbac_allowed=True,
                difc_allowed=True,
                workflow_allowed=True,
                workflow_id=wf_id,
                workflow_state_before=wf_before,
                workflow_transition=wf_trans,
                workflow_state_after=wf_after,
                workflow_rule=wf_rule,
                execution_certainty=wf_cert,
                aia_evaluated=True,
                aia_decision="ESCALATE",
                invariant_violation=aia_res.invariant_violation or "UNCERTAIN_SECURITY_CONTEXT",
                total_latency_ms=total_latency_ms,
                cbac_latency_ms=cbac_res.latency_ms,
                difc_latency_ms=difc_res.latency_ms,
                workflow_latency_ms=wf_lat,
                aia_latency_ms=aia_lat,
                model_revision=aia_res.model_revision
            )

        # AIA allowed -> Tool execution permitted
        return GatewayDecision(
            request_id=req.request_id,
            timestamp_utc=req.timestamp_utc,
            tool_name=req.tool_name,
            arguments_hash=req.arguments_hash(),
            final_decision="ALLOW",
            execution_permitted=True,
            reason_code="GATEWAY_ALL_CHECKS_PASSED",
            policy_id=cbac_res.policy_id,
            cbac_allowed=True,
            difc_allowed=True,
            workflow_allowed=True,
            workflow_id=wf_id,
            workflow_state_before=wf_before,
            workflow_transition=wf_trans,
            workflow_state_after=wf_after,
            workflow_rule=wf_rule,
            execution_certainty=wf_cert,
            aia_evaluated=True,
            aia_decision="ALLOW",
            invariant_violation="none",
            total_latency_ms=total_latency_ms,
            cbac_latency_ms=cbac_res.latency_ms,
            difc_latency_ms=difc_res.latency_ms,
            workflow_latency_ms=wf_lat,
            aia_latency_ms=aia_lat,
            model_revision=aia_res.model_revision
        )
