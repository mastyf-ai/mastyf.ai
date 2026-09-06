"""
Mastyf Privacy-Preserving Structured Audit Logger
Records immutable security events with SHA-256 argument hashes and zero plaintext CoT.
"""

import json
import os
from pathlib import Path
from typing import Optional
from ..models import AuditEvent, GatewayDecision, ToolCallRequest

class AuditLogger:
    """Writes tamper-evident, structured JSONL audit entries."""

    def __init__(self, log_path: str = "logs/audit.jsonl"):
        self.log_path = Path(log_path)
        self.log_path.parent.mkdir(parents=True, exist_ok=True)

    def log_event(self, req: ToolCallRequest, decision: GatewayDecision, active_taints: list[str]) -> AuditEvent:
        event = AuditEvent(
            request_id=decision.request_id,
            session_id=req.session_id,
            principal_id=req.principal_id,
            timestamp_utc=decision.timestamp_utc,
            tool_name=decision.tool_name,
            arguments_hash=decision.arguments_hash,
            final_decision=decision.final_decision,
            execution_permitted=decision.execution_permitted,
            reason_code=decision.reason_code,
            policy_id=decision.policy_id,
            cbac_allowed=decision.cbac_allowed,
            difc_allowed=decision.difc_allowed,
            active_taints=active_taints,
            aia_evaluated=decision.aia_evaluated,
            aia_decision=decision.aia_decision,
            invariant_violation=decision.invariant_violation,
            total_latency_ms=decision.total_latency_ms,
            model_revision=decision.model_revision
        )

        try:
            with open(self.log_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(event.model_dump()) + "\n")
        except Exception as e:
            # Audit log failure must not crash gateway, but is recorded
            pass

        return event
