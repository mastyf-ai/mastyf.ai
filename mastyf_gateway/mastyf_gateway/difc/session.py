"""
Mastyf DIFC Session State and Taint Evaluation Engine
Tracks taint tag accumulation across conversation turns and evaluates information flow safety.
"""

from typing import Dict, Set, List, Optional
import time
from .taint import SecurityTag, SinkCategory, DIFCLattice
from ..models import ToolCallRequest, DIFCDecision

class SessionTaintTracker:
    """Manages dynamic taint labels across interactive agent sessions."""

    def __init__(self, tool_sinks: Optional[Dict[str, SinkCategory]] = None):
        self.sessions: Dict[str, Set[SecurityTag]] = {}
        self.lattice = DIFCLattice()
        self.tool_sinks = tool_sinks or self.lattice.DEFAULT_TOOL_SINKS.copy()

    def get_session_taints(self, session_id: str) -> Set[SecurityTag]:
        return self.sessions.get(session_id, set()).copy()

    def add_taint(self, session_id: str, tag: SecurityTag | str) -> None:
        if isinstance(tag, str):
            try:
                tag = SecurityTag(tag)
            except ValueError:
                tag = SecurityTag.UNTRUSTED_WEB
        if session_id not in self.sessions:
            self.sessions[session_id] = set()
        self.sessions[session_id].add(tag)

    def clear_session(self, session_id: str) -> None:
        if session_id in self.sessions:
            del self.sessions[session_id]

    def record_tool_result(self, session_id: str, tool_name: str) -> None:
        """Propagates taint from tool outputs into the active session."""
        produced = self.lattice.TOOL_PRODUCED_TAINTS.get(tool_name, set())
        for tag in produced:
            self.add_taint(session_id, tag)

    def evaluate(self, req: ToolCallRequest) -> DIFCDecision:
        """
        Deterministically evaluates whether the requested tool sink is permitted
        given the active session taint labels and explicit request context tags.
        """
        start_time = time.perf_counter()

        # Combine session taints with any tags explicitly provided in request
        active_taints = self.get_session_taints(req.session_id)
        for t_str in req.context_taint_tags:
            try:
                active_taints.add(SecurityTag(t_str))
            except ValueError:
                active_taints.add(SecurityTag.UNTRUSTED_WEB)

        sink_cat = self.tool_sinks.get(req.tool_name, SinkCategory.READ_SOURCE)
        disallowed_tags = self.lattice.DISALLOWED_FLOWS.get(sink_cat, set())

        # Check for lattice violation
        for tag in active_taints:
            if tag in disallowed_tags:
                elapsed_ms = (time.perf_counter() - start_time) * 1000.0
                tag_val = tag.value if hasattr(tag, "value") else str(tag)
                tag_name = tag.name if hasattr(tag, "name") else str(tag)
                sink_val = sink_cat.value if hasattr(sink_cat, "value") else str(sink_cat)
                sink_name = sink_cat.name if hasattr(sink_cat, "name") else str(sink_cat)
                return DIFCDecision(
                    allowed=False,
                    active_taint_tags=[t.value if hasattr(t, "value") else str(t) for t in active_taints],
                    sink_security_label=sink_val,
                    violation_tag=tag_val,
                    reason_code=f"DIFC_DISALLOWED_FLOW_{tag_name}_TO_{sink_name}",
                    latency_ms=elapsed_ms
                )

        elapsed_ms = (time.perf_counter() - start_time) * 1000.0
        return DIFCDecision(
            allowed=True,
            active_taint_tags=[t.value if hasattr(t, "value") else str(t) for t in active_taints],
            sink_security_label=sink_cat.value if hasattr(sink_cat, "value") else str(sink_cat),
            reason_code="DIFC_OK",
            latency_ms=elapsed_ms
        )
