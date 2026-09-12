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
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .canonical import canonical_json, hash_arguments, hash_policy
from .models import (
    CURRENT_LEDGER_SCHEMA,
    GENESIS_PREVIOUS_HASH,
    ExecutionObservation,
    ExecutionReceipt,
    LedgerStatus,
    VerificationResult,
)


_HARNESS_RECEIPT_RE = re.compile(
    r"^(slo-e2e|node-e2e-lat|obs-prom|pw_shield|allow_once_next_)",
    re.IGNORECASE,
)


def is_harness_receipt_id(receipt_id: Optional[str]) -> bool:
    """Probe ids stay in the hash chain but must not enter customer KPIs."""
    if not receipt_id:
        return False
    return bool(_HARNESS_RECEIPT_RE.match(str(receipt_id)))


def _producing_layer(receipt: ExecutionReceipt) -> str:
    """Best-effort producing layer for a non-ALLOW receipt — never invents ALLOW."""
    code = str(getattr(receipt, "reason_code", "") or "").upper()
    if code.startswith("CBAC") or "CBAC_" in code:
        return "CBAC"
    if "DIFC" in code:
        return "DIFC"
    if "WORKFLOW" in code or "SEQUENCE" in code:
        return "WORKFLOW"
    if code.startswith("AIA") or "AUDITOR" in code or "INJECTION" in code:
        return "AIA"
    cbac = str(getattr(receipt, "cbac_decision", "") or "").upper()
    if cbac in ("DENY", "BLOCK"):
        return "CBAC"
    difc = str(getattr(receipt, "difc_decision", "") or "").upper()
    if difc in ("DENY", "BLOCK"):
        return "DIFC"
    aia = str(getattr(receipt, "aia_decision", "") or "").upper()
    if aia in ("DENY", "BLOCK", "ESCALATE"):
        return "AIA"
    return "ARBITER"


def _percentile_ms(samples: List[float], p: float) -> Optional[float]:
    if not samples:
        return None
    ordered = sorted(float(x) for x in samples)
    if len(ordered) == 1:
        return round(ordered[0], 2)
    k = (len(ordered) - 1) * (p / 100.0)
    lo = int(k)
    hi = min(len(ordered) - 1, lo + 1)
    frac = k - lo
    return round(ordered[lo] * (1.0 - frac) + ordered[hi] * frac, 2)


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
        server_id: Optional[str] = None,
        server_name: Optional[str] = None,
        client_name: Optional[str] = None,
        command_digest: Optional[str] = None,
        child_stdin_bytes: Optional[int] = None,
        workflow_decision: Optional[str] = None,
        cbac_latency_ms: Optional[float] = None,
        difc_latency_ms: Optional[float] = None,
        workflow_latency_ms: Optional[float] = None,
        aia_latency_ms: Optional[float] = None,
        total_latency_ms: Optional[float] = None,
        aia_engine: Optional[str] = None,
        aia_model: Optional[str] = None,
        aia_invariant_violation: Optional[str] = None,
        response_firewall_decision: Optional[str] = None,
        response_firewall_action: Optional[str] = None,
        response_firewall_reason: Optional[str] = None,
        response_secrets_redacted_count: Optional[int] = None,
        trace_id: Optional[str] = None,
    ) -> ExecutionReceipt:
        """
        Constructs, hashes, and atomically appends an execution receipt to disk.
        Schema 2 binds first-class MCP server identity into the hash chain.
        Schema 3 binds ActionTrace timings and Guard metadata when provided.
        Schema 4 binds response-firewall decision fields (never raw secrets).
        Arguments are secret-redacted before hashing so tokens never enter the ledger path.
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
            if child_stdin_bytes is None:
                child_stdin_bytes = 0
        elif obs_str == ExecutionObservation.RESPONSE_RECEIVED.value:
            backend_execution_count = 1
        elif obs_str == ExecutionObservation.SENT_CHILD_NO_RESPONSE.value:
            backend_execution_count = None
        else:
            backend_execution_count = 0
            obs_str = ExecutionObservation.NOT_SENT.value

        ts = timestamp_utc or datetime.now(timezone.utc).isoformat()
        # Never persist raw secrets — hash redacted args only
        try:
            from ..enforcement.secrets_scan import redact_args_for_persistence

            safe_args, arg_secret_hits = redact_args_for_persistence(
                tool_args if isinstance(tool_args, dict) else {}
            )
        except Exception:
            safe_args = tool_args if isinstance(tool_args, dict) else {}
            arg_secret_hits = []
        if arg_secret_hits and response_secrets_redacted_count is None:
            response_secrets_redacted_count = len(arg_secret_hits)
        elif arg_secret_hits and response_secrets_redacted_count is not None:
            response_secrets_redacted_count = int(response_secrets_redacted_count) + len(arg_secret_hits)

        args_hash = hash_arguments(safe_args)
        p_hash = hash_policy(policy_obj)

        resolved_server_name = server_name or None
        resolved_server_id = server_id or resolved_server_name

        with self._lock:
            seq = self._next_sequence_id
            prev_hash = self._last_receipt_hash

            common = dict(
                schema=CURRENT_LEDGER_SCHEMA,
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
                server_id=resolved_server_id,
                server_name=resolved_server_name,
                client_name=client_name,
                command_digest=command_digest,
                child_stdin_bytes=child_stdin_bytes,
                workflow_decision=workflow_decision,
                cbac_latency_ms=cbac_latency_ms,
                difc_latency_ms=difc_latency_ms,
                workflow_latency_ms=workflow_latency_ms,
                aia_latency_ms=aia_latency_ms,
                total_latency_ms=total_latency_ms,
                aia_engine=aia_engine,
                aia_model=aia_model,
                aia_invariant_violation=aia_invariant_violation,
                response_firewall_decision=response_firewall_decision,
                response_firewall_action=response_firewall_action,
                response_firewall_reason=response_firewall_reason,
                response_secrets_redacted_count=response_secrets_redacted_count,
                trace_id=trace_id or None,
            )

            receipt_candidate = ExecutionReceipt(**common)

            # Compute canonical receipt hash
            r_hash = receipt_candidate.compute_hash()
            receipt = ExecutionReceipt(**{**common, "receipt_hash": r_hash})

            # Atomically serialize, append, and flush to disk
            line = json.dumps(receipt.to_storage_dict(), ensure_ascii=False) + "\n"
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
                fields: List[str] = []
                seen = set()
                for row in receipts:
                    for key in row.keys():
                        if key not in seen:
                            seen.add(key)
                            fields.append(key)
                with open(out, "w", newline="", encoding="utf-8") as f:
                    writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
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

    def get_receipts(
        self,
        limit: int = 50,
        offset: int = 0,
        server_id: Optional[str] = None,
        server_name: Optional[str] = None,
    ) -> List[ExecutionReceipt]:
        """Returns paginated receipts from the ledger, optionally filtered by MCP server."""
        all_r = self.read_all_receipts()
        if server_id or server_name:
            needle_id = (server_id or "").strip()
            needle_name = (server_name or server_id or "").strip()
            filtered: List[ExecutionReceipt] = []
            for r in all_r:
                rid = r.resolved_server_id()
                rname = r._derive_server_name()
                if needle_id and rid == needle_id:
                    filtered.append(r)
                elif needle_name and (rname == needle_name or rid == needle_name):
                    filtered.append(r)
            all_r = filtered
        return all_r[offset : offset + limit]

    def get_receipt_by_id(self, receipt_id: str) -> Optional[ExecutionReceipt]:
        """Fetches receipt by request_id or receipt_hash."""
        for r in self.read_all_receipts():
            if r.request_id == receipt_id or r.receipt_hash == receipt_id:
                return r
        return None

    def server_stats(self) -> List[Dict[str, Any]]:
        """Aggregate allow/block/escalate counts per MCP server identity."""
        buckets: Dict[str, Dict[str, Any]] = {}
        for r in self.read_all_receipts():
            sid = r.resolved_server_id()
            name = r._derive_server_name()
            if sid not in buckets:
                buckets[sid] = {
                    "server_id": sid,
                    "server_name": name,
                    "client_name": r.client_name,
                    "command_digest": r.command_digest,
                    "total": 0,
                    "allowed": 0,
                    "blocked": 0,
                    "escalated": 0,
                    "zero_byte_enforcements": 0,
                    "last_tool": None,
                    "last_timestamp": None,
                    "last_decision": None,
                }
            b = buckets[sid]
            b["total"] += 1
            decision = r.arbiter_decision
            if decision == "ALLOW":
                b["allowed"] += 1
            elif decision == "BLOCK":
                b["blocked"] += 1
                b["zero_byte_enforcements"] += 1
            elif decision == "ESCALATE":
                b["escalated"] += 1
                b["zero_byte_enforcements"] += 1
            b["last_tool"] = r.tool_name
            b["last_timestamp"] = r.timestamp_utc
            b["last_decision"] = decision
            if r.client_name and not b.get("client_name"):
                b["client_name"] = r.client_name
            if r.command_digest and not b.get("command_digest"):
                b["command_digest"] = r.command_digest
        return sorted(buckets.values(), key=lambda x: (-x["total"], x["server_name"] or ""))

    def window_stats(
        self,
        since_utc: Optional[str] = None,
        until_utc: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Aggregate decision counts for receipts in [since, until] (ISO-8601 UTC).

        Missing/unparseable timestamps are excluded from the window (never invented).
        """
        from datetime import datetime, timezone

        def parse_ts(raw: Optional[str]) -> Optional[datetime]:
            if not raw:
                return None
            try:
                s = str(raw).strip().replace("Z", "+00:00")
                dt = datetime.fromisoformat(s)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt.astimezone(timezone.utc)
            except Exception:
                return None

        since_dt = parse_ts(since_utc)
        until_dt = parse_ts(until_utc)
        allowed = blocked = escalated = other = 0
        zero_byte = 0
        scanned = 0
        in_window = 0
        harness_excluded = 0
        newest: Optional[str] = None
        oldest: Optional[str] = None

        by_reason: Dict[str, int] = {}
        by_server: Dict[str, Dict[str, int]] = {}
        by_tool: Dict[str, Dict[str, int]] = {}
        by_layer: Dict[str, int] = {"CBAC": 0, "DIFC": 0, "WORKFLOW": 0, "AIA": 0, "ARBITER": 0}
        reason_last: Dict[str, str] = {}
        server_last: Dict[str, str] = {}
        latencies: List[float] = []
        last_block_id: Optional[str] = None
        last_escalate_id: Optional[str] = None

        def bump(bucket: Dict[str, Dict[str, int]], key: str, field: str) -> None:
            row = bucket.setdefault(key, {"allowed": 0, "blocked": 0, "escalated": 0, "total": 0})
            row[field] = int(row.get(field, 0)) + 1
            row["total"] = int(row.get("total", 0)) + 1

        for r in self.read_all_receipts():
            scanned += 1
            ts = parse_ts(getattr(r, "timestamp_utc", None))
            if ts is None:
                continue
            if since_dt is not None and ts < since_dt:
                continue
            if until_dt is not None and ts > until_dt:
                continue
            rid = r.request_id or f"rcpt-{r.sequence_id}"
            if is_harness_receipt_id(rid):
                harness_excluded += 1
                continue
            in_window += 1
            iso = ts.isoformat().replace("+00:00", "Z")
            if newest is None or iso > newest:
                newest = iso
            if oldest is None or iso < oldest:
                oldest = iso
            decision = getattr(r, "arbiter_decision", None) or ""
            server = (getattr(r, "server_name", None) or getattr(r, "server_id", None) or "unknown")
            tool = getattr(r, "tool_name", None) or "unknown"
            code = str(getattr(r, "reason_code", None) or "")
            if decision == "ALLOW":
                allowed += 1
                bump(by_server, str(server), "allowed")
                bump(by_tool, str(tool), "allowed")
            elif decision == "BLOCK":
                blocked += 1
                zero_byte += 1
                last_block_id = rid
                bump(by_server, str(server), "blocked")
                bump(by_tool, str(tool), "blocked")
                layer = _producing_layer(r)
                by_layer[layer] = by_layer.get(layer, 0) + 1
            elif decision == "ESCALATE":
                escalated += 1
                zero_byte += 1
                last_escalate_id = rid
                bump(by_server, str(server), "escalated")
                bump(by_tool, str(tool), "escalated")
                layer = _producing_layer(r)
                by_layer[layer] = by_layer.get(layer, 0) + 1
            else:
                other += 1
                for bucket, key in ((by_server, str(server)), (by_tool, str(tool))):
                    row = bucket.setdefault(key, {"allowed": 0, "blocked": 0, "escalated": 0, "total": 0})
                    row["total"] = int(row.get("total", 0)) + 1
            if code:
                by_reason[code] = by_reason.get(code, 0) + 1
                reason_last[code] = rid
            server_last[str(server)] = rid
            lat = getattr(r, "total_latency_ms", None)
            if lat is not None:
                try:
                    latencies.append(float(lat))
                except (TypeError, ValueError):
                    pass

        def top_rows(
            bucket: Dict[str, Dict[str, int]], last_ids: Dict[str, str], limit: int = 15
        ) -> List[Dict[str, Any]]:
            ranked = sorted(bucket.items(), key=lambda kv: int(kv[1].get("total", 0)), reverse=True)
            out: List[Dict[str, Any]] = []
            for key, counts in ranked[:limit]:
                out.append(
                    {
                        "name": key,
                        "allowed": int(counts.get("allowed", 0)),
                        "blocked": int(counts.get("blocked", 0)),
                        "escalated": int(counts.get("escalated", 0)),
                        "total": int(counts.get("total", 0)),
                        "last_receipt_id": last_ids.get(key),
                    }
                )
            return out

        reason_rows = [
            {"reason_code": k, "count": c, "last_receipt_id": reason_last.get(k)}
            for k, c in sorted(by_reason.items(), key=lambda kv: kv[1], reverse=True)[:15]
        ]

        return {
            "source": "live-ledger",
            "since": since_utc,
            "until": until_utc,
            "scanned_receipts": scanned,
            "harness_excluded": harness_excluded,
            "in_window": in_window,
            "allowed": allowed,
            "blocked": blocked,
            "escalated": escalated,
            "other": other,
            "zero_byte_enforcements": zero_byte,
            "oldest_in_window": oldest,
            "newest_in_window": newest,
            "by_reason": reason_rows,
            "by_server": top_rows(by_server, server_last),
            "by_tool": top_rows(by_tool, {}),
            "by_layer": by_layer,
            "last_block_receipt_id": last_block_id,
            "last_escalate_receipt_id": last_escalate_id,
            "latency": {
                "samples": len(latencies),
                "p50_ms": _percentile_ms(latencies, 50) if latencies else None,
                "p95_ms": _percentile_ms(latencies, 95) if latencies else None,
                "p99_ms": _percentile_ms(latencies, 99) if latencies else None,
            },
        }

