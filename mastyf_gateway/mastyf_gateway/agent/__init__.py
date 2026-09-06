"""
Mastyf Agent Package.
Conversational Agent Runtime with Gateway Reference Monitoring.
"""

from .session import AgentSession, ChatMessage, SecurityHUDEvent, ToolCallProposal
from .tools import ToolDefinition, ToolRegistry, create_demo_tools
from .runtime import BaseLLMClient, MockLLMClient, OpenAICompatibleLLMClient, ModelOutput
from .agent_loop import AgentLoop

__all__ = [
    "AgentSession",
    "ChatMessage",
    "SecurityHUDEvent",
    "ToolCallProposal",
    "ToolDefinition",
    "ToolRegistry",
    "create_demo_tools",
    "BaseLLMClient",
    "MockLLMClient",
    "OpenAICompatibleLLMClient",
    "ModelOutput",
    "AgentLoop",
]
