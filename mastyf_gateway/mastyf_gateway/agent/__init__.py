"""
Mastyf Agent Package.
Conversational Agent Runtime with Gateway Reference Monitoring.
"""

from .session import AgentSession, ChatMessage, SecurityHUDEvent, ToolCallProposal
from .tools import ToolDefinition, ToolRegistry, create_demo_tools
from .runtime import (
    BaseLLMClient,
    MockLLMClient,
    OpenAICompatibleLLMClient,
    ModelOutput,
    DetectedRuntime,
    detect_local_runtime,
)
from .agent_loop import AgentLoop
from .hud import SecurityHUDProjection

__all__ = [
    "AgentSession",
    "ChatMessage",
    "SecurityHUDEvent",
    "SecurityHUDProjection",
    "ToolCallProposal",
    "ToolDefinition",
    "ToolRegistry",
    "create_demo_tools",
    "BaseLLMClient",
    "MockLLMClient",
    "OpenAICompatibleLLMClient",
    "ModelOutput",
    "DetectedRuntime",
    "detect_local_runtime",
    "AgentLoop",
]
