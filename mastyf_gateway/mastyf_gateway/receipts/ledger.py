"""
Mastyf Execution Receipt Ledger.

Appends tamper-evident, hash-chained execution records to receipts.jsonl and
provides strict fail-closed chain verification and export capabilities.
"""

from __future__ import annotations

import csv
import io
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .canonical import canonical_json, hash_arguments, hash_policy
from .models import (
    GENESIS_PREVIOUS_HASH,
    ExecutionObservation,
    ExecutionReceipt,
    LedgerStatus,
    VerificationResult,
)


class LedgerCorruptionError(ValueError):
    """Raised when an existing receipt ledger file fails integrity or sequence verification."""


class ExecutionReceiptLedger:
    """Thread-safe append-only ledger managing execution receipts and hash chains."""

    def __init__(self, ledger_path: Optional[str] = None):
        if ledger_path is None:
            home = Path(os.environ.get("MASTYF_HOME", Path.home() / ".mastyf"))
            ledger_path = str(home / "receipts.jsonl")

        self.path = Path(ledger_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

        # Recovery state
        self._next_sequence_id: int = 0
        self._last_receipt_hash: str = GENESIS_PREVIOUS_HASH
        self._is_corrupted: bool = False
        self._corruption_detail: Optional[str] = None

        self._recover_state()

    @property
    def is_corrupted(self) -> bool:
        return self._is_corrupted

    @property
    def next_sequence_id(self) -> int:
        return self._next_sequence_id

    @property
    def last_receipt_hash(self) -> str:
        return self._last_receipt_hash

    def _recover_state(self) -> None:
        """
        Recovers head sequence ID and receipt hash on startup.
        Fails closed if existing file has corrupt JSON, hash mismatch, or sequence gap.
        """
        with self._lock:
            if not self.path.exists() or self.path.stat().st_size == 0:
                self._next_sequence_id = 0
                self._last_receipt_hash = GENESIS_PREVIOUS_HASH
                return

            # Validate entire file on recovery to guarantee integrity
            result = self._verify_file(self.path)
            if not result.valid:
                self._is_corrupted = True
                self._corruption_detail = result.error_message
                return

            self._next_sequence_id = result.total_receipts
            self._last_receipt_hash = result.head_receipt_hash or GENESIS_PREVIOUS_HASH

    def record(
        self,
        request_id: str,
        session_id: str,
        principal_id: str,
        tool_name: str,
        tool_args: Dict[str, Any],
        policy_id: str,
        policy_obj: Any,
        cbac_decision: str,
        difc_decision: str,
        aia_decision: str,
        arbiter_decision: str,
        execution_observation: ExecutionObservation | str,
        reason_code: str,
        timestamp_utc: Optional[str] = None,
        workflow_id: Optional[str] = None,
        workflow_state_before: Optional[str] = None,
        workflow_transition: Optional[str] = None,
        workflow_state_after: Optional[str] = None,
        workflow_rule: Optional[str] = None,
        execution_certainty: Optional[str] = "KNOWN",
    ) -> ExecutionReceipt:
        """
        Constructs, hashes, and atomically appends an execution receipt to disk.
        """
        if self._is_corrupted:
            raise LedgerCorruptionError(f"Cannot record to corrupted ledger: {self._corruption_detail}")

        if hasattr(execution_observation, "value"):
            obs_str = str(execution_observation.value)
        else:
            obs_str = str(execution_observation)

        if arbiter_decision != "ALLOW":
            backend_execution_count: Optional[int] = 0
            obs_str = ExecutionObservation.NOT_SENT.value
        elif obs_str == ExecutionObservation.RESPONSE_RECEIVED.value:
            backend_execution_count = 1
        elif obs_str == ExecutionObservation.SENT_CHILD_NO_RESPONSE.value:
            backend_execution_count = None
        else:
            backend_execution_count = 0
            obs_str = ExecutionObservation.NOT_SENT.value

        ts = timestamp_utc or datetime.now(timezone.utc).isoformat()
        args_hash = hash_arguments(tool_args)
        p_hash = hash_policy(policy_obj)

        with self._lock:
            seq = self._next_sequence_id
            prev_hash = self._last_receipt_hash

            receipt_candidate = ExecutionReceipt(
                schema=1,
                sequence_id=seq,
                timestamp_utc=ts,
                request_id=request_id,
                session_id=session_id,
                principal_id=principal_id,
                tool_name=tool_name,
                arguments_hash=args_hash,
                policy_id=policy_id,
                policy_hash=p_hash,
                cbac_decision=cbac_decision,
                difc_decision=difc_decision,
                aia_decision=aia_decision,
                arbiter_decision=arbiter_decision,
                backend_execution_count=backend_execution_count,
                execution_observation=obs_str,
                reason_code=reason_code,
                previous_receipt_hash=prev_hash,
                workflow_id=workflow_id,
                workflow_state_before=workflow_state_before,
                workflow_transition=workflow_transition,
                workflow_state_after=workflow_state_after,
                workflow_rule=workflow_rule,
                execution_certainty=execution_certainty or "KNOWN",
            )

            # Compute canonical receipt hash
            r_hash = receipt_candidate.compute_hash()
            receipt = ExecutionReceipt(
                schema=receipt_candidate.schema,
                sequence_id=receipt_candidate.sequence_id,
                timestamp_utc=receipt_candidate.timestamp_utc,
                request_id=receipt_candidate.request_id,
                session_id=receipt_candidate.session_id,
                principal_id=receipt_candidate.principal_id,
                tool_name=receipt_candidate.tool_name,
                arguments_hash=receipt_candidate.arguments_hash,
                policy_id=receipt_candidate.policy_id,
                policy_hash=receipt_candidate.policy_hash,
                cbac_decision=receipt_candidate.cbac_decision,
                difc_decision=receipt_candidate.difc_decision,
                aia_decision=receipt_candidate.aia_decision,
                arbiter_decision=receipt_candidate.arbiter_decision,
                backend_execution_count=receipt_candidate.backend_execution_count,
                execution_observation=receipt_candidate.execution_observation,
                reason_code=receipt_candidate.reason_code,
                previous_receipt_hash=receipt_candidate.previous_receipt_hash,
                receipt_hash=r_hash,
                workflow_id=workflow_id,
                workflow_state_before=workflow_state_before,
                workflow_transition=workflow_transition,
                workflow_state_after=workflow_state_after,
                workflow_rule=workflow_rule,
                execution_certainty=execution_certainty or "KNOWN",
            )

            # Atomically serialize, append, and flush to disk
            line = json.dumps(receipt.to_dict(), ensure_ascii=False) + "\n"
            with open(self.path, "a", encoding="utf-8") as f:
                f.write(line)
                f.flush()
                os.fsync(f.fileno())

            self._last_receipt_hash = r_hash
            self._next_sequence_id += 1

            return receipt

    @classmethod
    def _verify_file(cls, path: Path) -> VerificationResult:
        """
        Mechanically verifies the cryptographic hash chain and execution invariant
        over an entire JSONL receipt file.
        """
        if not path.exists() or path.stat().st_size == 0:
            return VerificationResult(valid=True, total_receipts=0)

        total = 0
        allows = 0
        blocks = 0
        escalates = 0
        observed_execs = 0
        unknown_execs = 0
        zero_execs = 0
        expected_seq = 0
        expected_prev_hash = GENESIS_PREVIOUS_HASH
        last_receipt_hash = None

        with open(path, "r", encoding="utf-8") as f:
            for line_idx, line in enumerate(f):
                line_str = line.strip()
                if not line_str:
                    continue

                try:
                    data = json.loads(line_str)
                except json.JSONDecodeError as exc:
                    return VerificationResult(
                        valid=False,
                        total_receipts=total,
                        error_message=f"Line {line_idx}: malformed JSON ({exc})",
                        error_sequence_id=expected_seq,
                    )

                if not isinstance(data, dict):
                    return VerificationResult(
                        valid=False,
                        total_receipts=total,
                        error_message=f"Line {line_idx}: record is not a JSON object",
                        error_sequence_id=expected_seq,
                    )

                try:
                    receipt = ExecutionReceipt.from_dict(data)
                except KeyError as e:
                    return VerificationResult(
                        valid=False,
                        total_receipts=total,
                        error_message=f"Line {line_idx}: missing required field {e}",
                        error_sequence_id=expected_seq,
                    )

                # 1. Sequence gap check
                if receipt.sequence_id != expected_seq:
                    return VerificationResult(
                        valid=False,
                        total_receipts=total,
                        error_message=f"Sequence gap: expected {expected_seq}, found {receipt.sequence_id}",
                        error_sequence_id=receipt.sequence_id,
                    )

                # 2. Previous hash linkage check
                if receipt.previous_receipt_hash != expected_prev_hash:
                    return VerificationResult(
                        valid=False,
                        total_receipts=total,
                        error_message=(
                            f"Previous hash mismatch at sequence {receipt.sequence_id}: "
                            f"expected {expected_prev_hash}, found {receipt.previous_receipt_hash}"
                        ),
                        error_sequence_id=receipt.sequence_id,
                    )

                # 3. Canonical receipt hash verification
                recomputed_hash = receipt.compute_hash()
                if receipt.receipt_hash != recomputed_hash:
                    return VerificationResult(
                        valid=False,
                        total_receipts=total,
                        error_message=(
                            f"Receipt hash mismatch at sequence {receipt.sequence_id}: "
                            f"claimed {receipt.receipt_hash}, calculated {recomputed_hash}"
                        ),
                        error_sequence_id=receipt.sequence_id,
                    )

                # 4. Security invariant verification:
                #    arbiter_decision != ALLOW => backend_execution_count == 0 && NOT_SENT
                if receipt.arbiter_decision != "ALLOW":
                    if receipt.backend_execution_count != 0 or receipt.execution_observation != "NOT_SENT":
                        return VerificationResult(
                            valid=False,
                            total_receipts=total,
                            error_message=(
                                f"Security invariant violation at sequence {receipt.sequence_id}: "
                                f"decision is {receipt.arbiter_decision} but backend_execution_count is "
                                f"{receipt.backend_execution_count} (observation={receipt.execution_observation})"
                            ),
                            error_sequence_id=receipt.sequence_id,
                        )
                else:
                    # ALLOW must be either (1, RESPONSE_RECEIVED) or (None, SENT_CHILD_NO_RESPONSE)
                    if receipt.execution_observation == "RESPONSE_RECEIVED":
                        if receipt.backend_execution_count != 1:
                            return VerificationResult(
                                valid=False,
                                total_receipts=total,
                                error_message=(
                                    f"Invalid execution count at sequence {receipt.sequence_id}: "
                                    f"observation is RESPONSE_RECEIVED but count is {receipt.backend_execution_count}"
                                ),
                                error_sequence_id=receipt.sequence_id,
                            )
                    elif receipt.execution_observation == "SENT_CHILD_NO_RESPONSE":
                        if receipt.backend_execution_count is not None:
                            return VerificationResult(
                                valid=False,
                                total_receipts=total,
                                error_message=(
                                    f"Invalid execution count at sequence {receipt.sequence_id}: "
                                    f"observation is SENT_CHILD_NO_RESPONSE but count is not null"
                                ),
                                error_sequence_id=receipt.sequence_id,
                            )

                # Tally distributions
                if receipt.arbiter_decision == "ALLOW":
                    allows += 1
                elif receipt.arbiter_decision == "BLOCK":
                    blocks += 1
                elif receipt.arbiter_decision == "ESCALATE":
                    escalates += 1

                if receipt.backend_execution_count == 1:
                    observed_execs += 1
                elif receipt.backend_execution_count is None:
                    unknown_execs += 1
                elif receipt.backend_execution_count == 0:
                    zero_execs += 1

                total += 1
                expected_prev_hash = receipt.receipt_hash
                last_receipt_hash = receipt.receipt_hash
                expected_seq += 1

        return VerificationResult(
            valid=True,
            total_receipts=total,
            allow_count=allows,
            block_count=blocks,
            escalate_count=escalates,
            observed_execution_count=observed_execs,
            unknown_execution_count=unknown_execs,
            zero_execution_count=zero_execs,
            head_sequence_id=expected_seq - 1 if total > 0 else None,
            head_receipt_hash=last_receipt_hash,
        )

    def verify(self) -> VerificationResult:
        """Verifies the active ledger file."""
        return self._verify_file(self.path)

    @classmethod
    def verify_file(cls, path: str | Path) -> VerificationResult:
        """Verifies an arbitrary receipt file on disk."""
        return cls._verify_file(Path(path))

    def get_status(self) -> LedgerStatus:
        """Returns high-level status and integrity check of the ledger."""
        res = self.verify()
        if not self.path.exists() or self.path.stat().st_size == 0:
            return LedgerStatus(
                ledger_path=str(self.path),
                chain_length=0,
                allow_count=0,
                block_count=0,
                escalate_count=0,
                chain_integrity="EMPTY",
                security_invariant="N/A",
            )

        return LedgerStatus(
            ledger_path=str(self.path),
            chain_length=res.total_receipts,
            allow_count=res.allow_count,
            block_count=res.block_count,
            escalate_count=res.escalate_count,
            chain_integrity="VALID" if res.valid else "CORRUPTED",
            security_invariant="VALID" if res.valid else "VIOLATED",
            head_hash=res.head_receipt_hash,
            head_sequence_id=res.head_sequence_id,
        )

    def export(self, output_path: str | Path, format: str = "json") -> int:
        """Exports receipts to JSON, JSONL, or CSV."""
        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)

        if not self.path.exists() or self.path.stat().st_size == 0:
            receipts: List[Dict[str, Any]] = []
        else:
            with open(self.path, "r", encoding="utf-8") as f:
                receipts = [json.loads(line) for line in f if line.strip()]

        fmt = format.lower().strip()
        if fmt == "json":
            out.write_text(json.dumps(receipts, indent=2, ensure_ascii=False), encoding="utf-8")
        elif fmt == "jsonl":
            with open(out, "w", encoding="utf-8") as f:
                for r in receipts:
                    f.write(json.dumps(r, ensure_ascii=False) + "\n")
        elif fmt == "csv":
            if not receipts:
                out.write_text("", encoding="utf-8")
            else:
                fields = list(receipts[0].keys())
                with open(out, "w", newline="", encoding="utf-8") as f:
                    writer = csv.DictWriter(f, fieldnames=fields)
                    writer.writeheader()
                    writer.writerows(receipts)
        else:
            raise ValueError(f"Unsupported export format: {format} (expected json, jsonl, or csv)")

        return len(receipts)

    def read_all_receipts(self) -> List[ExecutionReceipt]:
        """Reads and parses all receipts stored in the ledger."""
        if not self.path.exists() or self.path.stat().st_size == 0:
            return []
        receipts = []
        with open(self.path, "r", encoding="utf-8") as f:
            for line in f:
                line_str = line.strip()
                if line_str:
                    receipts.append(ExecutionReceipt.from_dict(json.loads(line_str)))
        return receipts

    def get_receipt(self, sequence_id: int) -> Optional[ExecutionReceipt]:
        """Fetches a specific execution receipt by sequence ID."""
        for r in self.read_all_receipts():
            if r.sequence_id == sequence_id:
                return r
        return None

