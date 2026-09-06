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
    GatewayDecision,
    DecisionType
)

class DecisionArbiter:
    """
    Formal Decision Arbiter implementing:
    1. Authority Monotonicity: Authority(Final) <= Authority(CBAC) & Authority(DIFC)
    2. Execution Rule: Final == ALLOW => CBAC == ALLOW & DIFC == ALLOW & AIA == ALLOW
    3. ESCALATE / BLOCK terminal safety: Neither state permits tool execution.
    """

    def arbitrate(
        self,
        req: ToolCallRequest,
        cbac_res: CBACDecision,
        difc_res: DIFCDecision,
        aia_res: Optional[AIADecision] = None,
        total_latency_ms: float = 0.0
    ) -> GatewayDecision:
        """
        Synthesizes component decisions into an immutable GatewayDecision.
        """
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
                aia_evaluated=False,
                aia_decision=None,
                invariant_violation="CBAC_AUTHORITY_DENIAL",
                total_latency_ms=total_latency_ms,
                cbac_latency_ms=cbac_res.latency_ms,
                difc_latency_ms=difc_res.latency_ms,
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
                aia_evaluated=False,
                aia_decision=None,
                invariant_violation="DIFC_FLOW_VIOLATION",
                total_latency_ms=total_latency_ms,
                cbac_latency_ms=cbac_res.latency_ms,
                difc_latency_ms=difc_res.latency_ms,
                aia_latency_ms=0.0
            )

        # Step 3: Pure deterministic path (no AIA required / configured)
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
                aia_evaluated=False,
                aia_decision=None,
                invariant_violation="none",
                total_latency_ms=total_latency_ms,
                cbac_latency_ms=cbac_res.latency_ms,
                difc_latency_ms=difc_res.latency_ms,
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
                aia_evaluated=True,
                aia_decision="ESCALATE",
                invariant_violation="AUDITOR_TIMEOUT",
                total_latency_ms=total_latency_ms,
                cbac_latency_ms=cbac_res.latency_ms,
                difc_latency_ms=difc_res.latency_ms,
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
                aia_evaluated=True,
                aia_decision="ESCALATE",
                invariant_violation="AUDITOR_MALFORMED_SCHEMA",
                total_latency_ms=total_latency_ms,
                cbac_latency_ms=cbac_res.latency_ms,
                difc_latency_ms=difc_res.latency_ms,
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
                aia_evaluated=True,
                aia_decision="BLOCK",
                invariant_violation=aia_res.invariant_violation or "NEURAL_AUDITOR_BLOCK",
                total_latency_ms=total_latency_ms,
                cbac_latency_ms=cbac_res.latency_ms,
                difc_latency_ms=difc_res.latency_ms,
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
                aia_evaluated=True,
                aia_decision="ESCALATE",
                invariant_violation=aia_res.invariant_violation or "UNCERTAIN_SECURITY_CONTEXT",
                total_latency_ms=total_latency_ms,
                cbac_latency_ms=cbac_res.latency_ms,
                difc_latency_ms=difc_res.latency_ms,
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
            aia_evaluated=True,
            aia_decision="ALLOW",
            invariant_violation="none",
            total_latency_ms=total_latency_ms,
            cbac_latency_ms=cbac_res.latency_ms,
            difc_latency_ms=difc_res.latency_ms,
            aia_latency_ms=aia_lat,
            model_revision=aia_res.model_revision
        )
