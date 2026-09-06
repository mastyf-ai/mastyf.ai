"""
Mastyf Security Gateway Data Models
Defines immutable request, decision, policy, and audit telemetry types.
"""

from typing import Dict, Any, List, Optional, Literal, Set
from pydantic import BaseModel, Field
import time
import hashlib
import json

# First-class terminal decisions
DecisionType = Literal["ALLOW", "BLOCK", "ESCALATE"]

class ToolCallRequest(BaseModel):
    """Normalized incoming tool invocation proposed by an agent or user."""
    request_id: str
    session_id: str
    principal_id: str
    user_intent: str
    tool_name: str
    tool_args: Dict[str, Any] = Field(default_factory=dict)
    retrieved_context: Optional[str] = "None"
    context_taint_tags: List[str] = Field(default_factory=list)
    timestamp_utc: float = Field(default_factory=time.time)

    def arguments_hash(self) -> str:
        """Returns deterministic SHA256 of the proposed arguments to avoid logging plaintext secrets."""
        serialized = json.dumps(self.tool_args, sort_keys=True)
        return hashlib.sha256(serialized.encode("utf-8")).hexdigest()

class CBACDecision(BaseModel):
    """Outcome of deterministic Capability-Based Access Control evaluation."""
    allowed: bool
    capability_name: Optional[str] = None
    policy_id: Optional[str] = None
    reason_code: str = "CBAC_OK"
    latency_ms: float = 0.0

class DIFCDecision(BaseModel):
    """Outcome of Decentralized Information Flow Control (taint) evaluation."""
    allowed: bool
    active_taint_tags: List[str] = Field(default_factory=list)
    sink_security_label: Optional[str] = None
    violation_tag: Optional[str] = None
    reason_code: str = "DIFC_OK"
    latency_ms: float = 0.0

class AIADecision(BaseModel):
    """Outcome of Neural Active Intent & Injection Auditor evaluation."""
    decision: DecisionType = "BLOCK"
    confidence: float = 1.0
    invariant_violation: Optional[str] = "none"
    reason_code: str = "AIA_VERIFIED"
    malformed: bool = False
    timed_out: bool = False
    latency_ms: float = 0.0
    model_revision: str = "d59a6aa01f9139dff106146addb04109afa69c03"

class WorkflowDecision(BaseModel):
    """Outcome of Stateful Workflow & Sequence Policy evaluation."""
    allowed: bool = True
    reason_code: str = "WORKFLOW_PERMITTED"
    workflow_id: Optional[str] = None
    workflow_state_before: Optional[str] = None
    workflow_transition: Optional[str] = None
    workflow_state_after: Optional[str] = None
    workflow_rule: Optional[str] = None
    execution_certainty: str = "KNOWN"
    latency_ms: float = 0.0

class GatewayDecision(BaseModel):
    """Final unified decision rendered by the Gateway Decision Arbiter."""
    request_id: str
    timestamp_utc: float
    tool_name: str
    arguments_hash: str
    final_decision: DecisionType
    execution_permitted: bool  # Strictly True iff final_decision == 'ALLOW'
    reason_code: str
    policy_id: Optional[str] = None
    cbac_allowed: bool
    difc_allowed: bool
    workflow_allowed: bool = True
    workflow_id: Optional[str] = None
    workflow_state_before: Optional[str] = None
    workflow_transition: Optional[str] = None
    workflow_state_after: Optional[str] = None
    workflow_rule: Optional[str] = None
    execution_certainty: str = "KNOWN"
    aia_evaluated: bool
    aia_decision: Optional[DecisionType] = None
    invariant_violation: Optional[str] = "none"
    total_latency_ms: float
    cbac_latency_ms: float = 0.0
    difc_latency_ms: float = 0.0
    workflow_latency_ms: float = 0.0
    aia_latency_ms: float = 0.0
    model_revision: str = "d59a6aa01f9139dff106146addb04109afa69c03"

class AuditEvent(BaseModel):
    """Privacy-preserving structured security event for logging and SIEM ingestion."""
    request_id: str
    session_id: str
    principal_id: str
    timestamp_utc: float
    tool_name: str
    arguments_hash: str
    final_decision: DecisionType
    execution_permitted: bool
    reason_code: str
    policy_id: Optional[str] = None
    cbac_allowed: bool
    difc_allowed: bool
    active_taints: List[str] = Field(default_factory=list)
    aia_evaluated: bool
    aia_decision: Optional[DecisionType] = None
    invariant_violation: Optional[str] = "none"
    total_latency_ms: float
    model_revision: str = "d59a6aa01f9139dff106146addb04109afa69c03"
