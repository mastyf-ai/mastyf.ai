"""
Mastyf Agent Loop & Mediated Action Boundary.
Enforces the strict Phase 5 invariant:
Agent -> Mastyf Gateway -> Tool Execution
All proposed tool calls must pass deterministic authorization (CBAC ∩ DIFC ∩ Workflow)
before any byte is dispatched to a real backend.
"""

from __future__ import annotations

import json
import time
import uuid
from typing import Any, Callable, Dict, List, Optional

from ..gateway import MastyfGateway
from ..models import ToolCallRequest
from ..receipts.ledger import ExecutionReceiptLedger
from ..receipts.models import ExecutionObservation
from .runtime import BaseLLMClient
from .session import AgentSession, SecurityHUDEvent
from .tools import ToolRegistry
from .hud import SecurityHUDProjection


class AgentLoop:
    """
    Coordinates the conversational agent loop with the Mastyf Gateway reference monitor.
    Ensures zero-byte non-ALLOW dispatch and real-time security transparency.
    """

    def __init__(
        self,
        gateway: MastyfGateway,
        tools: ToolRegistry,
        llm: BaseLLMClient,
        ledger: Optional[ExecutionReceiptLedger] = None,
        on_hud_event: Optional[Callable[[SecurityHUDEvent], None]] = None,
        max_turns_per_prompt: int = 10,
    ):
        self.gateway = gateway
        self.tools = tools
        self.llm = llm
        self.ledger = ledger or ExecutionReceiptLedger()
        self.on_hud_event = on_hud_event
        self.max_turns = max_turns_per_prompt

    async def run_turn(self, session: AgentSession, user_input: str) -> str:
        """
        Processes a single user conversational turn:
        1. Appends user input to session history.
        2. Iteratively queries LLM until a final response is generated.
        3. Mediates and intercepts EVERY proposed tool call through Mastyf Gateway.
        """
        session.add_user_message(user_input)

        turn_count = 0
        final_response: str = ""

        while turn_count < self.max_turns:
            turn_count += 1

            # Query LLM with current context and registered tools
            llm_messages = session.get_messages_for_llm()
            tool_schemas = self.tools.to_openai_tools()

            output = await self.llm.generate(llm_messages, tools=tool_schemas if tool_schemas else None)

            # Record assistant turn in context
            raw_tool_calls = (
                [
                    {
                        "id": tc.call_id,
                        "type": "function",
                        "function": {"name": tc.name, "arguments": json.dumps(tc.args)},
                    }
                    for tc in output.tool_calls
                ]
                if output.tool_calls
                else None
            )
            session.add_assistant_message(content=output.content, tool_calls=raw_tool_calls)

            # If no tool calls proposed, conversation has completed this turn
            if not output.tool_calls:
                final_response = output.content or ""
                break

            # Mediated Tool Execution Pipeline (STRICT INVARIANT: No direct execution)
            for call in output.tool_calls:
                req_id = f"req_{uuid.uuid4().hex[:10]}"
                req = ToolCallRequest(
                    request_id=req_id,
                    session_id=session.session_id,
                    principal_id=session.principal_id,
                    user_intent=user_input,
                    tool_name=call.name,
                    tool_args=call.args,
                    timestamp_utc=time.time(),
                )

                # 1. Gate evaluation: CBAC ∩ DIFC ∩ Workflow + AIA -> Arbiter
                decision = await self.gateway.evaluate_async(req)

                receipt_hash: Optional[str] = None
                seq_id: Optional[int] = None

                if decision.final_decision == "ALLOW":
                    # 2a. Permitted dispatch
                    try:
                        tool_result = await self.tools.execute_async(call.name, call.args)
                        str_result = json.dumps(tool_result)
                        bytes_count = len(str_result.encode("utf-8"))
                        observation = ExecutionObservation.RESPONSE_RECEIVED
                        tool_msg_content = str_result
                    except Exception as e:
                        tool_result = {"error": f"Tool execution failed: {str(e)}"}
                        str_result = json.dumps(tool_result)
                        bytes_count = len(str_result.encode("utf-8"))
                        observation = ExecutionObservation.SENT_CHILD_NO_RESPONSE
                        tool_msg_content = str_result

                    # Commit state transition in workflow engine
                    self.gateway.workflow.commit_outcome(
                        session.session_id, call.name, observation, request_id=req_id
                    )

                    # Append cryptographically chained receipt
                    receipt = self.ledger.record(
                        request_id=req_id,
                        session_id=session.session_id,
                        principal_id=session.principal_id,
                        tool_name=call.name,
                        tool_args=call.args,
                        policy_id=decision.policy_id or "default-policy",
                        policy_obj=self.gateway.policy,
                        cbac_decision="ALLOW" if decision.cbac_allowed else "DENY",
                        difc_decision="ALLOW" if decision.difc_allowed else "BLOCK",
                        aia_decision=decision.aia_decision or "NOT_EVALUATED",
                        arbiter_decision=decision.final_decision,
                        execution_observation=observation,
                        reason_code=decision.reason_code,
                        workflow_id=decision.workflow_id,
                        workflow_state_before=decision.workflow_state_before,
                        workflow_transition=decision.workflow_transition if observation == ExecutionObservation.RESPONSE_RECEIVED else None,
                        workflow_state_after=decision.workflow_state_after if observation == ExecutionObservation.RESPONSE_RECEIVED else decision.workflow_state_before,
                        workflow_rule=decision.workflow_rule,
                        execution_certainty="KNOWN" if observation == ExecutionObservation.RESPONSE_RECEIVED else "UNKNOWN",
                    )
                    receipt_hash = receipt.receipt_hash
                    seq_id = receipt.sequence_id

                    # Record taint propagation
                    self.gateway.difc.record_tool_result(session.session_id, call.name)

                    # Emit HUD Event strictly derived from authoritative receipt
                    event = SecurityHUDProjection.project_from_receipt(
                        receipt=receipt,
                        ledger=self.ledger,
                        bytes_dispatched=bytes_count,
                        rule_violated=None,
                        tool_args=call.args,
                    )
                    event.timestamp = time.time()
                    session.add_hud_event(event)
                    if self.on_hud_event:
                        self.on_hud_event(event)

                    # Feed result back to model
                    session.add_tool_message(
                        tool_call_id=call.call_id, name=call.name, content=tool_msg_content
                    )

                else:
                    # 2b. Blocked / Escalated: ZERO BYTES DISPATCHED TO TOOL BACKEND
                    observation = ExecutionObservation.NOT_SENT

                    # Commit outcome in workflow engine (discards pending transition)
                    self.gateway.workflow.commit_outcome(
                        session.session_id, call.name, observation, request_id=req_id
                    )

                    # Append receipt establishing non-execution guarantee
                    receipt = self.ledger.record(
                        request_id=req_id,
                        session_id=session.session_id,
                        principal_id=session.principal_id,
                        tool_name=call.name,
                        tool_args=call.args,
                        policy_id=decision.policy_id or "default-policy",
                        policy_obj=self.gateway.policy,
                        cbac_decision="ALLOW" if decision.cbac_allowed else "DENY",
                        difc_decision="ALLOW" if decision.difc_allowed else "BLOCK",
                        aia_decision=decision.aia_decision or "NOT_EVALUATED",
                        arbiter_decision=decision.final_decision,
                        execution_observation=observation,
                        reason_code=decision.reason_code,
                        workflow_id=decision.workflow_id,
                        workflow_state_before=decision.workflow_state_before,
                        workflow_transition=None,
                        workflow_state_after=decision.workflow_state_before,
                        workflow_rule=decision.workflow_rule,
                        execution_certainty=decision.execution_certainty or "KNOWN",
                    )
                    receipt_hash = receipt.receipt_hash
                    seq_id = receipt.sequence_id

                    # Structured error frame for model
                    error_payload = {
                        "status": "blocked",
                        "blocked_by_gateway": True,
                        "decision": decision.final_decision,
                        "reason": decision.reason_code,
                        "invariant_violation": decision.invariant_violation,
                        "detail": "Execution of this action was blocked by Mastyf Security Gateway. "
                        "Exactly zero bytes were delivered to the tool backend.",
                    }

                    # Emit HUD Event strictly derived from authoritative receipt
                    event = SecurityHUDProjection.project_from_receipt(
                        receipt=receipt,
                        ledger=self.ledger,
                        bytes_dispatched=0,  # Strict Zero-Byte Invariant
                        rule_violated=decision.invariant_violation,
                        tool_args=call.args,
                    )
                    event.timestamp = time.time()
                    session.add_hud_event(event)
                    if self.on_hud_event:
                        self.on_hud_event(event)

                    # Feed policy block message back to model
                    session.add_tool_message(
                        tool_call_id=call.call_id,
                        name=call.name,
                        content=json.dumps(error_payload),
                    )

        return final_response
