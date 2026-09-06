"""
Mastyf Security Gateway Health & Readiness Verification
"""

from typing import Dict, Any
from ..policy.cbac import CBACEngine
from ..difc.session import SessionTaintTracker
from ..auditor.aia import BaseAIAAuditor

class HealthChecker:
    """Performs liveness, readiness, policy verification, and auditor sanity checks."""

    def __init__(
        self,
        cbac_engine: CBACEngine,
        difc_tracker: SessionTaintTracker,
        auditor: BaseAIAAuditor
    ):
        self.cbac_engine = cbac_engine
        self.difc_tracker = difc_tracker
        self.auditor = auditor

    def check_liveness(self) -> Dict[str, Any]:
        return {"status": "ok", "service": "mastyf-gateway", "version": "0.1.0"}

    def check_readiness(self) -> Dict[str, Any]:
        policy_loaded = self.cbac_engine.policy is not None
        cap_count = len(self.cbac_engine.policy.capabilities) if self.cbac_engine.policy else 0
        return {
            "status": "ready" if policy_loaded else "unhealthy",
            "policy_loaded": policy_loaded,
            "policy_id": self.cbac_engine.policy.policy_id if policy_loaded else None,
            "capabilities_indexed": cap_count,
            "difc_active_sessions": len(self.difc_tracker.sessions)
        }
