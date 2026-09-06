"""
Adversarial Gateway test harness fixture for Phase 4 workflow security validation.
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest

from mastyf_gateway.policy.loader import validate_policy, compile_policy
from mastyf_gateway.gateway import MastyfGateway
from mastyf_gateway.receipts import ExecutionReceiptLedger, ExecutionObservation, ExecutionReceipt
from mastyf_gateway.models import ToolCallRequest
from mastyf_gateway.auditor.aia import MockAIAAuditor


ADVERSARIAL_POLICY_YAML = """id: adversarial-test-agent
version: "1.0"
capabilities:
  - tool: customer.lookup
    actions: [read]
  - tool: read_balance
    actions: [read]
  - tool: ticket.update
    actions: [write]
  - tool: slack.post_message
    actions: [write]
  - tool: external_http_request
    actions: [write]
  - tool: export_csv
    actions: [export]
  - tool: webhook.post
    actions: [write]
  - tool: email.send
    actions: [write]
  - tool: http.request
    actions: [write]
  - tool: http.post
    actions: [write]
  - tool: cloud_storage.upload
    actions: [write]

workflows:
  - name: pii-protection
    scope: session
    initial_state: CLEAN
    states:
      - CLEAN
      - PII_OBSERVED

    transitions:
      - from: CLEAN
        on: customer.lookup
        to: PII_OBSERVED

    constraints:
      - when_state: PII_OBSERVED
        deny:
          - slack.post_message
          - webhook.post
          - email.send
          - export_csv
          - http.request
          - http.post
          - cloud_storage.upload
        reason: "EXFILTRATION_PREVENTION: Cannot export data after observing PII"

      - when_execution_certainty: UNKNOWN
        deny:
          - ticket.update
          - export_csv
          - database.delete
          - slack.post_message
        reason: "UNCERTAIN_EXECUTION_DENIAL: Actions restricted under UNKNOWN certainty"

  - name: balance-protection
    scope: session
    initial_state: CLEAN
    states:
      - CLEAN
      - BALANCE_OBSERVED

    transitions:
      - from: CLEAN
        on: read_balance
        to: BALANCE_OBSERVED

    constraints:
      - when_state: BALANCE_OBSERVED
        deny:
          - external_http_request
        reason: "EXFILTRATION_PREVENTION: Cannot exfiltrate financial balance"
"""


@dataclass
class InvocationResult:
    decision: str
    execution_observation: str
    backend_execution_count: Optional[int]
    execution_permitted: bool
    reason_code: str
    result: Optional[Any] = None


class AdversarialGatewayHarness:
    def __init__(self, base_dir: Path):
        self.base_dir = base_dir
        self._lock = threading.RLock()

        pol_file = self.base_dir / "adversarial_policy.yaml"
        pol_file.write_text(ADVERSARIAL_POLICY_YAML, encoding="utf-8")
        self.decl_policy = validate_policy(str(pol_file))
        self.compiled_policy = compile_policy(self.decl_policy)
        self.gw_policy = self.compiled_policy.to_gateway_policy()

        self.auditor = MockAIAAuditor(simulated_latency_ms=0.2)
        self.gateway = MastyfGateway(
            policy=self.gw_policy,
            compiled_policy=self.compiled_policy,
            auditor=self.auditor,
        )

        self._stdin_bytes: Dict[str, bytes] = {}
        self._execution_counts: Dict[str, int] = {}
        self._ledgers: Dict[str, ExecutionReceiptLedger] = {}
        self._req_counter = 0

    def _get_ledger(self, session_id: str) -> ExecutionReceiptLedger:
        with self._lock:
            if session_id not in self._ledgers:
                ledger_file = self.base_dir / f"ledger_{session_id}.jsonl"
                self._ledgers[session_id] = ExecutionReceiptLedger(ledger_path=str(ledger_file))
            return self._ledgers[session_id]

    def reset(self, session_id: str) -> None:
        with self._lock:
            self.gateway.workflow.reset_session(session_id)
            self._stdin_bytes[session_id] = b""
            self._execution_counts[session_id] = 0
            ledger_file = self.base_dir / f"ledger_{session_id}.jsonl"
            if ledger_file.exists():
                ledger_file.unlink()
            self._ledgers[session_id] = ExecutionReceiptLedger(ledger_path=str(ledger_file))

    def child_stdin_bytes(self, session_id: str) -> bytes:
        with self._lock:
            return self._stdin_bytes.get(session_id, b"")

    def child_execution_count(self, session_id: str) -> int:
        with self._lock:
            return self._execution_counts.get(session_id, 0)

    def workflow_state(self, session_id: str) -> str:
        return self.gateway.workflow.get_state(session_id, "pii-protection")

    def execution_certainty(self, session_id: str) -> str:
        return self.gateway.workflow.get_certainty(session_id, "pii-protection")

    def malformed_json(self, session_id: str) -> None:
        pass

    def call(
        self,
        session_id: str,
        tool_name: str,
        arguments: Dict[str, Any],
        force_child_no_response: bool = False,
        force_aia_allow: bool = False,
    ) -> InvocationResult:
        with self._lock:
            self._req_counter += 1
            req_id = f"req-adv-{self._req_counter}"
            ledger = self._get_ledger(session_id)

            req = ToolCallRequest(
                request_id=req_id,
                session_id=session_id,
                principal_id="test_agent",
                user_intent=f"Call tool {tool_name}",
                tool_name=tool_name,
                tool_args=arguments,
            )

            decision = self.gateway.evaluate(req)

            if force_aia_allow and not decision.execution_permitted and decision.reason_code.startswith("AIA"):
                decision.final_decision = "ALLOW"
                decision.execution_permitted = True

            if decision.execution_permitted:
                if force_child_no_response:
                    dispatched_bytes = json.dumps({"tool": tool_name, "args": arguments}).encode("utf-8") + b"\n"
                    self._stdin_bytes[session_id] = self._stdin_bytes.get(session_id, b"") + dispatched_bytes
                    obs = ExecutionObservation.SENT_CHILD_NO_RESPONSE
                    backend_count = None
                else:
                    dispatched_bytes = json.dumps({"tool": tool_name, "args": arguments}).encode("utf-8") + b"\n"
                    self._stdin_bytes[session_id] = self._stdin_bytes.get(session_id, b"") + dispatched_bytes
                    self._execution_counts[session_id] = self._execution_counts.get(session_id, 0) + 1
                    obs = ExecutionObservation.RESPONSE_RECEIVED
                    backend_count = 1
            else:
                obs = ExecutionObservation.NOT_SENT
                backend_count = 0

            self.gateway.workflow.commit_outcome(session_id, tool_name, obs, request_id=req_id)

            ledger.record(
                request_id=req_id,
                session_id=session_id,
                principal_id="test_agent",
                tool_name=tool_name,
                tool_args=arguments,
                policy_id=decision.policy_id or "adversarial-test-agent",
                policy_obj=self.compiled_policy,
                cbac_decision="ALLOW" if decision.cbac_allowed else "DENY",
                difc_decision="ALLOW" if decision.difc_allowed else "BLOCK",
                aia_decision=decision.aia_decision or "NOT_EVALUATED",
                arbiter_decision=decision.final_decision,
                execution_observation=obs,
                reason_code=decision.reason_code,
                workflow_id=decision.workflow_id,
                workflow_state_before=decision.workflow_state_before,
                workflow_transition=decision.workflow_transition if obs == ExecutionObservation.RESPONSE_RECEIVED else None,
                workflow_state_after=decision.workflow_state_after if obs == ExecutionObservation.RESPONSE_RECEIVED else decision.workflow_state_before,
                workflow_rule=decision.workflow_rule,
                execution_certainty="KNOWN" if obs == ExecutionObservation.RESPONSE_RECEIVED else ("UNKNOWN" if obs == ExecutionObservation.SENT_CHILD_NO_RESPONSE else decision.execution_certainty),
            )

            return InvocationResult(
                decision=decision.final_decision,
                execution_observation=obs.value if hasattr(obs, "value") else str(obs),
                backend_execution_count=backend_count,
                execution_permitted=decision.execution_permitted,
                reason_code=decision.reason_code,
                result={"status": "OK"} if backend_count == 1 else None,
            )

    def receipts(self, session_id: str) -> List[ExecutionReceipt]:
        ledger = self._get_ledger(session_id)
        receipt_list = []
        if Path(ledger.path).exists():
            with open(ledger.path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        receipt_list.append(ExecutionReceipt.from_dict(json.loads(line)))
        return receipt_list

    def verify_ledger(self, session_id: str) -> None:
        ledger = self._get_ledger(session_id)
        res = ledger.verify()
        if not res.valid:
            raise AssertionError(f"Ledger verification failed: {res.error_message}")

    def tamper_last_receipt(self, session_id: str, field: str) -> None:
        ledger = self._get_ledger(session_id)
        p = Path(ledger.path)
        if not p.exists():
            return
        lines = [l for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]
        if not lines:
            return
        last_obj = json.loads(lines[-1])
        last_obj[field] = "TAMPERED_VAL"
        lines[-1] = json.dumps(last_obj, ensure_ascii=False)
        p.write_text("\n".join(lines) + "\n", encoding="utf-8")


@pytest.fixture
def adversarial_gateway(tmp_path_factory):
    base_dir = tmp_path_factory.mktemp("adv_gw")
    return AdversarialGatewayHarness(base_dir)
