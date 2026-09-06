"""
Mastyf Execution Receipt Data Models and Verification Types.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any, Dict, Optional
from .canonical import canonical_hash, canonical_json

GENESIS_PREVIOUS_HASH = "0" * 64


class ExecutionObservation(str, Enum):
    RESPONSE_RECEIVED = "RESPONSE_RECEIVED"
    SENT_CHILD_NO_RESPONSE = "SENT_CHILD_NO_RESPONSE"
    NOT_SENT = "NOT_SENT"


@dataclass(frozen=True)
class ExecutionReceipt:
    schema: int
    sequence_id: int
    timestamp_utc: str
    request_id: str
    session_id: str
    principal_id: str
    tool_name: str
    arguments_hash: str
    policy_id: str
    policy_hash: str
    cbac_decision: str
    difc_decision: str
    aia_decision: str
    arbiter_decision: str
    backend_execution_count: Optional[int]
    execution_observation: str
    reason_code: str
    previous_receipt_hash: str
    receipt_hash: str = ""
    workflow_id: Optional[str] = None
    workflow_state_before: Optional[str] = None
    workflow_transition: Optional[str] = None
    workflow_state_after: Optional[str] = None
    workflow_rule: Optional[str] = None
    execution_certainty: Optional[str] = "KNOWN"

    def to_canonical_dict(self) -> Dict[str, Any]:
        """Returns the deterministic dictionary for hash computation (excluding receipt_hash)."""
        d = asdict(self)
        d.pop("receipt_hash", None)
        if self.workflow_id is None:
            d.pop("workflow_id", None)
            d.pop("workflow_state_before", None)
            d.pop("workflow_transition", None)
            d.pop("workflow_state_after", None)
            d.pop("workflow_rule", None)
            d.pop("execution_certainty", None)
        return d

    def compute_hash(self) -> str:
        """Computes SHA-256 over the canonical JSON of all receipt fields except receipt_hash."""
        return canonical_hash(self.to_canonical_dict())

    def to_dict(self) -> Dict[str, Any]:
        """Full serializable dictionary including the calculated receipt_hash."""
        d = asdict(self)
        if self.workflow_id is None:
            d.pop("workflow_id", None)
            d.pop("workflow_state_before", None)
            d.pop("workflow_transition", None)
            d.pop("workflow_state_after", None)
            d.pop("workflow_rule", None)
            d.pop("execution_certainty", None)
        return d

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> ExecutionReceipt:
        """Instantiates and returns an ExecutionReceipt from a dictionary."""
        return cls(
            schema=int(data.get("schema", 1)),
            sequence_id=int(data["sequence_id"]),
            timestamp_utc=str(data["timestamp_utc"]),
            request_id=str(data["request_id"]),
            session_id=str(data["session_id"]),
            principal_id=str(data["principal_id"]),
            tool_name=str(data["tool_name"]),
            arguments_hash=str(data["arguments_hash"]),
            policy_id=str(data["policy_id"]),
            policy_hash=str(data["policy_hash"]),
            cbac_decision=str(data["cbac_decision"]),
            difc_decision=str(data["difc_decision"]),
            aia_decision=str(data["aia_decision"]),
            arbiter_decision=str(data["arbiter_decision"]),
            backend_execution_count=(
                int(data["backend_execution_count"])
                if data.get("backend_execution_count") is not None
                else None
            ),
            execution_observation=str(data["execution_observation"]),
            reason_code=str(data["reason_code"]),
            previous_receipt_hash=str(data["previous_receipt_hash"]),
            receipt_hash=str(data["receipt_hash"]),
            workflow_id=data.get("workflow_id"),
            workflow_state_before=data.get("workflow_state_before"),
            workflow_transition=data.get("workflow_transition"),
            workflow_state_after=data.get("workflow_state_after"),
            workflow_rule=data.get("workflow_rule"),
            execution_certainty=data.get("execution_certainty", "KNOWN"),
        )


@dataclass
class VerificationResult:
    valid: bool
    total_receipts: int = 0
    allow_count: int = 0
    block_count: int = 0
    escalate_count: int = 0
    observed_execution_count: int = 0
    unknown_execution_count: int = 0
    zero_execution_count: int = 0
    head_sequence_id: Optional[int] = None
    head_receipt_hash: Optional[str] = None
    error_message: Optional[str] = None
    error_sequence_id: Optional[int] = None


@dataclass
class LedgerStatus:
    ledger_path: str
    chain_length: int
    allow_count: int
    block_count: int
    escalate_count: int
    chain_integrity: str  # "VALID", "CORRUPTED", "EMPTY"
    security_invariant: str  # "VALID", "VIOLATED", "N/A"
    head_hash: Optional[str] = None
    head_sequence_id: Optional[int] = None
