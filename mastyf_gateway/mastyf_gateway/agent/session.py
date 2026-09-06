"""
Mastyf Agent Session & Conversation State.
Maintains chat history, security HUD events, and per-session telemetry.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class ToolCallProposal:
    """Represents a tool call proposed by the model."""
    call_id: str
    name: str
    args: Dict[str, Any]


@dataclass
class ChatMessage:
    """Unified chat message compatible with standard model context windows."""
    role: str  # "system", "user", "assistant", "tool"
    content: Optional[str] = None
    tool_calls: Optional[List[Dict[str, Any]]] = None
    tool_call_id: Optional[str] = None
    name: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"role": self.role}
        if self.content is not None:
            d["content"] = self.content
        if self.tool_calls is not None:
            d["tool_calls"] = self.tool_calls
        if self.tool_call_id is not None:
            d["tool_call_id"] = self.tool_call_id
        if self.name is not None:
            d["name"] = self.name
        return d


@dataclass
class SecurityHUDEvent:
    """Security transparency event emitted whenever a tool proposal is evaluated."""
    timestamp: float
    tool_name: str
    tool_args: Dict[str, Any]
    decision: str  # "ALLOW", "BLOCK", "ESCALATE"
    reason_code: str
    rule_violated: Optional[str] = None
    bytes_dispatched: int = 0  # Invariant: 0 on BLOCK or ESCALATE
    receipt_hash: Optional[str] = None
    sequence_id: Optional[int] = None
    execution_certainty: str = "NOT_SENT"  # "RESPONSE_RECEIVED", "NOT_SENT", "UNKNOWN"
    capability_status: str = "allowed"
    data_flow_status: str = "clean"
    workflow_status: str = "valid"
    execution_count: int = 0
    tamper_detected: bool = False
    session_id: Optional[str] = None
    request_id: Optional[str] = None


class AgentSession:
    """Maintains active conversation context and security audit trail for a session."""

    def __init__(
        self,
        session_id: Optional[str] = None,
        principal_id: str = "mastyf_user",
        system_prompt: Optional[str] = None,
    ):
        self.session_id: str = session_id or f"sess_{uuid.uuid4().hex[:12]}"
        self.principal_id: str = principal_id
        self.created_at: float = time.time()
        self.messages: List[ChatMessage] = []
        self.hud_events: List[SecurityHUDEvent] = []

        default_system = (
            "You are Mastyf Agent, an intelligent autonomous assistant. "
            "All your tool calls are protected by Mastyf Security Gateway. "
            "When performing actions, propose the appropriate tool calls. "
            "If a tool call is blocked by security policy, acknowledge the constraint "
            "and suggest safe alternatives or explain what happened to the user."
        )
        self.add_system_message(system_prompt or default_system)

    def add_system_message(self, content: str) -> None:
        self.messages.append(ChatMessage(role="system", content=content))

    def add_user_message(self, content: str) -> None:
        self.messages.append(ChatMessage(role="user", content=content))

    def add_assistant_message(
        self, content: Optional[str], tool_calls: Optional[List[Dict[str, Any]]] = None
    ) -> None:
        self.messages.append(
            ChatMessage(role="assistant", content=content, tool_calls=tool_calls)
        )

    def add_tool_message(self, tool_call_id: str, name: str, content: str) -> None:
        self.messages.append(
            ChatMessage(role="tool", tool_call_id=tool_call_id, name=name, content=content)
        )

    def add_hud_event(self, event: SecurityHUDEvent) -> None:
        self.hud_events.append(event)

    def get_messages_for_llm(self) -> List[Dict[str, Any]]:
        return [m.to_dict() for m in self.messages]
