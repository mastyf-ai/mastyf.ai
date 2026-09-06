"""
Mastyf Stateful Workflow Authorization Engine.

Implements the finite-state policy graph, session state tracking,
execution certainty tracking (KNOWN vs UNKNOWN), outcome-conditioned state commits,
and monotonic authority constraints.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from ..models import ToolCallRequest, WorkflowDecision
from ..receipts.models import ExecutionObservation


class WorkflowEngine:
    """
    Thread-safe finite-state workflow and sequence policy engine.
    """

    def __init__(self, compiled_policy: Optional[Any] = None):
        self._lock = threading.RLock()
        self.workflows: Dict[str, Dict[str, Any]] = {}
        if compiled_policy is not None:
            if hasattr(compiled_policy, "workflows"):
                self.workflows = compiled_policy.workflows
            elif isinstance(compiled_policy, dict) and "workflows" in compiled_policy:
                self.workflows = compiled_policy["workflows"]

        # Session state stores:
        # session_id -> {workflow_name: current_state}
        self._session_states: Dict[str, Dict[str, str]] = {}
        # session_id -> {workflow_name: "KNOWN" | "UNKNOWN"}
        self._session_certainties: Dict[str, Dict[str, str]] = {}
        # session_id -> {tool_name: invocation_count}
        self._session_tool_counts: Dict[str, Dict[str, int]] = {}
        # session_id -> [tool_name, ...] chronological history
        self._session_history: Dict[str, List[str]] = {}
        # (session_id, request_id) -> pending transition dict
        self._pending_transitions: Dict[Tuple[str, str], Dict[str, Any]] = {}

    def get_state(self, session_id: str, workflow_name: str) -> str:
        """Returns the current declared workflow state for a session."""
        with self._lock:
            states = self._session_states.setdefault(session_id, {})
            if workflow_name in states:
                return states[workflow_name]
            # Default to declared initial_state or "CLEAN"
            wf_spec = self.workflows.get(workflow_name, {})
            init_state = wf_spec.get("initial_state", "CLEAN")
            states[workflow_name] = init_state
            return init_state

    def get_certainty(self, session_id: str, workflow_name: str) -> str:
        """Returns the execution certainty ('KNOWN' or 'UNKNOWN') for a session workflow."""
        with self._lock:
            certainties = self._session_certainties.setdefault(session_id, {})
            return certainties.get(workflow_name, "KNOWN")

    def reset_session(self, session_id: str) -> None:
        """Resets all workflow tracking and history for a session."""
        with self._lock:
            self._session_states.pop(session_id, None)
            self._session_certainties.pop(session_id, None)
            self._session_tool_counts.pop(session_id, None)
            self._session_history.pop(session_id, None)
            to_del = [k for k in self._pending_transitions if k[0] == session_id]
            for k in to_del:
                self._pending_transitions.pop(k, None)

    def evaluate(self, req: ToolCallRequest) -> WorkflowDecision:
        """
        Evaluates a proposed tool call against all active workflow state graphs,
        constraints, sequence restrictions, and execution certainty.
        """
        start_time = time.perf_counter()
        session_id = req.session_id
        tool_name = req.tool_name

        with self._lock:
            if not self.workflows:
                # Pass-through if no workflows declared
                latency_ms = (time.perf_counter() - start_time) * 1000.0
                return WorkflowDecision(
                    allowed=True,
                    reason_code="WORKFLOW_NO_POLICY",
                    execution_certainty="KNOWN",
                    latency_ms=latency_ms,
                )

            # Primary tracking metadata for the decision receipt
            first_wf_name: Optional[str] = None
            first_state_before: Optional[str] = None
            first_state_after: Optional[str] = None
            first_transition: Optional[str] = None
            first_certainty: str = "KNOWN"

            for wf_name, spec in self.workflows.items():
                current_state = self.get_state(session_id, wf_name)
                current_certainty = self.get_certainty(session_id, wf_name)

                if first_wf_name is None:
                    first_wf_name = wf_name
                    first_state_before = current_state
                    first_state_after = current_state
                    first_certainty = current_certainty

                # 1. Execution Certainty Constraints
                constraints = spec.get("constraints", [])
                for c in constraints:
                    when_cert = c.get("when_execution_certainty")
                    if when_cert and when_cert == current_certainty:
                        denied_tools = c.get("deny", [])
                        if tool_name in denied_tools:
                            latency_ms = (time.perf_counter() - start_time) * 1000.0
                            rule_str = f"when_execution_certainty: {when_cert} -> deny: {tool_name}"
                            return WorkflowDecision(
                                allowed=False,
                                reason_code=c.get("reason") or f"UNCERTAIN_EXECUTION_DENIAL: Tool '{tool_name}' prohibited when certainty is {current_certainty}",
                                workflow_id=wf_name,
                                workflow_state_before=current_state,
                                workflow_transition=None,
                                workflow_state_after=current_state,
                                workflow_rule=rule_str,
                                execution_certainty=current_certainty,
                                latency_ms=latency_ms,
                            )

                # 2. State-Dependent Constraints
                for c in constraints:
                    when_st = c.get("when_state")
                    if when_st and when_st == current_state:
                        denied_tools = c.get("deny", [])
                        if tool_name in denied_tools:
                            latency_ms = (time.perf_counter() - start_time) * 1000.0
                            rule_str = f"when_state: {current_state} -> deny: {tool_name}"
                            return WorkflowDecision(
                                allowed=False,
                                reason_code=c.get("reason") or f"WORKFLOW_CONSTRAINT_VIOLATION: Tool '{tool_name}' prohibited in state '{current_state}'",
                                workflow_id=wf_name,
                                workflow_state_before=current_state,
                                workflow_transition=None,
                                workflow_state_after=current_state,
                                workflow_rule=rule_str,
                                execution_certainty=current_certainty,
                                latency_ms=latency_ms,
                            )

                # 3. Cannot Follow Rules
                cannot_follow = spec.get("cannot_follow", [])
                hist = self._session_history.get(session_id, [])
                for cf in cannot_follow:
                    trigger = cf.get("trigger")
                    forbidden = cf.get("forbidden", [])
                    if tool_name in forbidden and trigger in hist:
                        latency_ms = (time.perf_counter() - start_time) * 1000.0
                        rule_str = f"cannot_follow: {trigger} -> {tool_name}"
                        return WorkflowDecision(
                            allowed=False,
                            reason_code=f"CANNOT_FOLLOW_VIOLATION: Tool '{tool_name}' cannot follow '{trigger}' in session",
                            workflow_id=wf_name,
                            workflow_state_before=current_state,
                            workflow_transition=None,
                            workflow_state_after=current_state,
                            workflow_rule=rule_str,
                            execution_certainty=current_certainty,
                            latency_ms=latency_ms,
                        )

                # 4. Requires State Rules
                requires_state = spec.get("requires_state", [])
                for rs in requires_state:
                    req_tool = rs.get("tool")
                    req_st = rs.get("state")
                    if tool_name == req_tool and current_state != req_st:
                        latency_ms = (time.perf_counter() - start_time) * 1000.0
                        rule_str = f"requires_state: {req_tool} requires {req_st}"
                        return WorkflowDecision(
                            allowed=False,
                            reason_code=f"REQUIRES_STATE_VIOLATION: Tool '{tool_name}' requires state '{req_st}', but current state is '{current_state}'",
                            workflow_id=wf_name,
                            workflow_state_before=current_state,
                            workflow_transition=None,
                            workflow_state_after=current_state,
                            workflow_rule=rule_str,
                            execution_certainty=current_certainty,
                            latency_ms=latency_ms,
                        )

                # 5. Max Occurrences Rules
                max_occ = spec.get("max_occurrences", [])
                tool_counts = self._session_tool_counts.get(session_id, {})
                for mo in max_occ:
                    lim_tool = mo.get("tool")
                    count_limit = mo.get("count", 0)
                    if tool_name == lim_tool:
                        current_c = tool_counts.get(lim_tool, 0)
                        if current_c >= count_limit:
                            latency_ms = (time.perf_counter() - start_time) * 1000.0
                            rule_str = f"max_occurrences: {lim_tool} limit {count_limit}"
                            return WorkflowDecision(
                                allowed=False,
                                reason_code=f"MAX_OCCURRENCES_EXCEEDED: Tool '{tool_name}' exceeded maximum allowed occurrences ({count_limit}) in session",
                                workflow_id=wf_name,
                                workflow_state_before=current_state,
                                workflow_transition=None,
                                workflow_state_after=current_state,
                                workflow_rule=rule_str,
                                execution_certainty=current_certainty,
                                latency_ms=latency_ms,
                            )

                # 6. Potential State Transitions
                transitions = spec.get("transitions", [])
                for t in transitions:
                    from_st = t.get("from")
                    on_tool = t.get("on_tool")
                    to_st = t.get("to")
                    if from_st == current_state and on_tool == tool_name:
                        first_state_after = to_st
                        first_transition = f"{tool_name} -> {to_st}"
                        # Store pending transition to commit only upon confirmed child response
                        self._pending_transitions[(session_id, req.request_id)] = {
                            "workflow_name": wf_name,
                            "state_before": current_state,
                            "state_after": to_st,
                            "tool_name": tool_name,
                        }
                        break

            # If all workflows permitted:
            latency_ms = (time.perf_counter() - start_time) * 1000.0
            return WorkflowDecision(
                allowed=True,
                reason_code="WORKFLOW_PERMITTED",
                workflow_id=first_wf_name,
                workflow_state_before=first_state_before,
                workflow_transition=first_transition,
                workflow_state_after=first_state_after,
                workflow_rule=None,
                execution_certainty=first_certainty,
                latency_ms=latency_ms,
            )

    def commit_outcome(
        self,
        session_id: str,
        tool_name: str,
        observation: ExecutionObservation | str,
        request_id: Optional[str] = None,
    ) -> None:
        """
        Commits or rolls back workflow state based on observed transport outcome.

        - RESPONSE_RECEIVED:
            Commits pending transition to state_after.
            Marks execution certainty as 'KNOWN'.
            Increments verified execution count and records to session history.
        - SENT_CHILD_NO_RESPONSE:
            Retains prior declared state (does NOT commit next state).
            Sets execution certainty to 'UNKNOWN'.
            Discards pending transition.
        - NOT_SENT:
            Retains prior declared state (does NOT commit next state).
            Leaves certainty unchanged.
            Discards pending transition.
        """
        obs_val = observation.value if hasattr(observation, "value") else str(observation)

        with self._lock:
            # Find and extract any pending transition
            pending = None
            if request_id:
                pending = self._pending_transitions.pop((session_id, request_id), None)
            if pending is None:
                # Match by session and tool name if request_id wasn't registered
                matched_key = None
                for k, v in self._pending_transitions.items():
                    if k[0] == session_id and v.get("tool_name") == tool_name:
                        matched_key = k
                        pending = v
                        break
                if matched_key:
                    self._pending_transitions.pop(matched_key, None)

            wf_name = pending.get("workflow_name") if pending else (list(self.workflows.keys())[0] if self.workflows else None)

            if obs_val == ExecutionObservation.RESPONSE_RECEIVED.value:
                # 1. Successful verified execution
                if pending and wf_name:
                    states = self._session_states.setdefault(session_id, {})
                    states[wf_name] = pending["state_after"]

                if wf_name:
                    certs = self._session_certainties.setdefault(session_id, {})
                    certs[wf_name] = "KNOWN"

                counts = self._session_tool_counts.setdefault(session_id, {})
                counts[tool_name] = counts.get(tool_name, 0) + 1

                hist = self._session_history.setdefault(session_id, [])
                hist.append(tool_name)

            elif obs_val == ExecutionObservation.SENT_CHILD_NO_RESPONSE.value:
                # 2. Child crashed or timed out after dispatch: outcome unknown!
                # Retain prior declared state; mark execution certainty as UNKNOWN
                if wf_name:
                    certs = self._session_certainties.setdefault(session_id, {})
                    certs[wf_name] = "UNKNOWN"

            else:
                # 3. NOT_SENT (blocked or escalated): definitely no execution
                # State does not advance; pending transition is discarded
                pass
