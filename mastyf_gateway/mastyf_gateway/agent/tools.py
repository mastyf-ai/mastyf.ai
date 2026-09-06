"""
Mastyf Tool Registry & Function Definitions.
Registers tools, exports standard OpenAI JSON Schemas, and executes dispatched calls.
"""

from __future__ import annotations

import inspect
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional


@dataclass
class ToolDefinition:
    """Definition of an executable tool available to the agent."""
    name: str
    description: str
    parameters: Dict[str, Any]
    func: Callable[..., Any]
    security_class: str = "UNKNOWN"  # READ, WRITE, DESTRUCTIVE, SENSITIVE_SOURCE, EXTERNAL_SINK, UNKNOWN

    def to_openai_schema(self) -> Dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


class ToolRegistry:
    """Registry managing available tools and their schema representations."""

    def __init__(self):
        self._tools: Dict[str, ToolDefinition] = {}

    def register(self, tool: ToolDefinition) -> None:
        self._tools[tool.name] = tool

    def register_fn(
        self,
        name: str,
        func: Callable[..., Any],
        description: str,
        parameters: Optional[Dict[str, Any]] = None,
        security_class: str = "UNKNOWN",
    ) -> None:
        params = parameters or {
            "type": "object",
            "properties": {},
            "required": [],
        }
        tool = ToolDefinition(
            name=name,
            description=description,
            parameters=params,
            func=func,
            security_class=security_class,
        )
        self.register(tool)

    def get(self, name: str) -> Optional[ToolDefinition]:
        return self._tools.get(name)

    def list_tools(self) -> List[ToolDefinition]:
        return list(self._tools.values())

    def to_openai_tools(self) -> List[Dict[str, Any]]:
        return [tool.to_openai_schema() for tool in self._tools.values()]

    async def execute_async(self, name: str, args: Dict[str, Any]) -> Any:
        tool = self.get(name)
        if not tool:
            raise KeyError(f"Tool '{name}' not found in registry")

        if inspect.iscoroutinefunction(tool.func):
            return await tool.func(**args)
        return tool.func(**args)


def create_demo_tools() -> ToolRegistry:
    """Creates a standard set of demonstration tools representing enterprise operations."""
    registry = ToolRegistry()

    def get_invoices(status: str = "unpaid") -> List[Dict[str, Any]]:
        return [
            {"invoice_id": "INV-101", "customer": "Acme Corp", "amount": 4500.0, "status": "unpaid", "due_date": "2026-09-01"},
            {"invoice_id": "INV-102", "customer": "Globex Inc", "amount": 12000.0, "status": "unpaid", "due_date": "2026-09-04"},
        ]

    registry.register_fn(
        name="invoice.search",
        func=get_invoices,
        description="Search customer invoices by status (paid, unpaid, overdue).",
        parameters={
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": ["paid", "unpaid", "overdue"], "description": "Invoice status"}
            },
            "required": ["status"],
        },
        security_class="READ",
    )

    def customer_lookup(customer_id: str) -> Dict[str, Any]:
        return {
            "customer_id": customer_id,
            "name": "Jane Doe",
            "email": "jane.doe@enterprise.com",
            "ssn_last4": "8821",
            "account_balance": 18500.0,
            "classification": "CONFIDENTIAL_PII",
        }

    registry.register_fn(
        name="customer.lookup",
        func=customer_lookup,
        description="Look up confidential customer account records and contact details.",
        parameters={
            "type": "object",
            "properties": {
                "customer_id": {"type": "string", "description": "Customer identifier"}
            },
            "required": ["customer_id"],
        },
        security_class="SENSITIVE_SOURCE",
    )

    def send_email(recipient: str, subject: str, body: str) -> Dict[str, Any]:
        return {"status": "sent", "recipient": recipient, "subject": subject, "bytes": len(body)}

    registry.register_fn(
        name="email.send",
        func=send_email,
        description="Send an email to an internal or external recipient.",
        parameters={
            "type": "object",
            "properties": {
                "recipient": {"type": "string", "description": "Destination email address"},
                "subject": {"type": "string", "description": "Email subject line"},
                "body": {"type": "string", "description": "Email message body"},
            },
            "required": ["recipient", "subject", "body"],
        },
        security_class="EXTERNAL_SINK",
    )

    def slack_post(channel: str, message: str) -> Dict[str, Any]:
        return {"status": "posted", "channel": channel, "ts": "1725619200.001"}

    registry.register_fn(
        name="slack.post_message",
        func=slack_post,
        description="Post a message to an internal company Slack channel.",
        parameters={
            "type": "object",
            "properties": {
                "channel": {"type": "string", "description": "Slack channel name (e.g. #finance, #leadership)"},
                "message": {"type": "string", "description": "Message text"},
            },
            "required": ["channel", "message"],
        },
        security_class="EXTERNAL_SINK",
    )

    def external_http(url: str, method: str = "POST", data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return {"status": "dispatched", "url": url, "bytes_sent": 256}

    registry.register_fn(
        name="http.request",
        func=external_http,
        description="Make an arbitrary external HTTP request to a remote web server or API.",
        parameters={
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "Target HTTP URL"},
                "method": {"type": "string", "enum": ["GET", "POST", "PUT"], "default": "POST"},
                "data": {"type": "object", "description": "Payload body to transmit"},
            },
            "required": ["url"],
        },
        security_class="EXTERNAL_SINK",
    )

    return registry
