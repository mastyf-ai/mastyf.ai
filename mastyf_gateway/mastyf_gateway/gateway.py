"""
Mastyf Security Gateway v0.1 Core Pipeline
Deterministic Reference Monitor with Neural Auditor Escalation for AI Agent Tool Calls.
"""

from typing import Optional, Dict, Any, Callable, Awaitable
import time
import asyncio

from .models import ToolCallRequest, GatewayDecision, DecisionType
from .config import GatewayConfig
from .policy.cbac import CBACEngine
from .policy.schemas import PolicyDocument
from .difc.session import SessionTaintTracker
from .auditor.aia import BaseAIAAuditor, MockAIAAuditor, LocalV6Auditor
from .enforcement.arbiter import DecisionArbiter
from .telemetry.audit import AuditLogger
from .telemetry.metrics import GatewayMetrics
from .health.checks import HealthChecker

class MastyfGateway:
    """
    Unified Mastyf Security Gateway.
    Enforces:
    1. Deterministic CBAC Policy.
    2. Deterministic DIFC Taint Tracking.
    3. Neural AIA Intent Auditing on permissible calls.
    4. Immutable Decision Arbitration & SHA-256 Audit Logging.
    """

    def __init__(
        self,
        config: Optional[GatewayConfig] = None,
        policy: Optional[PolicyDocument] = None,
        auditor: Optional[BaseAIAAuditor] = None
    ):
        self.config = config or GatewayConfig()
        self.cbac = CBACEngine(policy=policy)
        self.difc = SessionTaintTracker()

        if auditor is not None:
            self.auditor = auditor
        elif self.config.aia.mock_mode:
            self.auditor = MockAIAAuditor()
        else:
            self.auditor = LocalV6Auditor(config=self.config.aia)

        self.arbiter = DecisionArbiter()
        self.logger = AuditLogger(log_path=self.config.telemetry.audit_log_path)
        self.metrics = GatewayMetrics()
        self.health = HealthChecker(self.cbac, self.difc, self.auditor)

    @property
    def policy(self) -> Optional[PolicyDocument]:
        return self.cbac.policy

    async def evaluate_async(self, req: ToolCallRequest) -> GatewayDecision:
        """
        Asynchronously evaluates the proposed tool call across all security layers.
        """
        start_time = time.perf_counter()

        # Layer 1: Deterministic CBAC
        cbac_res = self.cbac.evaluate(req)

        # Layer 2: Deterministic DIFC
        difc_res = self.difc.evaluate(req)

        # Layer 3: AIA Neural Auditor (Evaluated only if CBAC and DIFC permit)
        aia_res = None
        if cbac_res.allowed and difc_res.allowed and self.config.aia.enabled:
            aia_res = await self.auditor.evaluate(req)

        total_elapsed_ms = (time.perf_counter() - start_time) * 1000.0

        # Layer 4: Decision Arbiter
        decision = self.arbiter.arbitrate(
            req=req,
            cbac_res=cbac_res,
            difc_res=difc_res,
            aia_res=aia_res,
            total_latency_ms=total_elapsed_ms
        )

        # Layer 5: Audit Telemetry & Metrics
        active_taints = [t.value for t in self.difc.get_session_taints(req.session_id)]
        if self.config.telemetry.enabled:
            self.logger.log_event(req, decision, active_taints)

        self.metrics.record_decision(
            final_decision=decision.final_decision,
            cbac_allowed=decision.cbac_allowed,
            difc_allowed=decision.difc_allowed,
            aia_evaluated=decision.aia_evaluated,
            aia_decision=decision.aia_decision,
            total_latency_ms=decision.total_latency_ms,
            cbac_latency_ms=decision.cbac_latency_ms,
            difc_latency_ms=decision.difc_latency_ms,
            aia_latency_ms=decision.aia_latency_ms,
            timed_out=aia_res.timed_out if aia_res else False,
            malformed=aia_res.malformed if aia_res else False
        )

        return decision

    def evaluate(self, req: ToolCallRequest) -> GatewayDecision:
        """Synchronous wrapper for evaluate_async."""
        return asyncio.run(self.evaluate_async(req))

    async def execute_async(
        self,
        req: ToolCallRequest,
        tool_fn: Callable[..., Awaitable[Any]]
    ) -> Dict[str, Any]:
        """
        Guarded execution pipeline:
        Evaluates the request; executes the underlying tool IF AND ONLY IF decision == 'ALLOW'.
        Updates session taint tracking on execution result.
        """
        decision = await self.evaluate_async(req)

        if not decision.execution_permitted:
            return {
                "success": False,
                "decision": decision.final_decision,
                "reason_code": decision.reason_code,
                "invariant_violation": decision.invariant_violation,
                "result": None,
                "gateway_decision": decision.model_dump()
            }

        # Safe execution
        try:
            result = await tool_fn(**req.tool_args)
            # Record taint propagation
            self.difc.record_tool_result(req.session_id, req.tool_name)
            return {
                "success": True,
                "decision": "ALLOW",
                "reason_code": "EXECUTION_SUCCESSFUL",
                "result": result,
                "gateway_decision": decision.model_dump()
            }
        except Exception as e:
            return {
                "success": False,
                "decision": "ALLOW",
                "reason_code": f"TOOL_RUNTIME_ERROR: {str(e)}",
                "result": None,
                "gateway_decision": decision.model_dump()
            }
