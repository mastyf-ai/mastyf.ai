"""
Model Context Protocol (MCP) Proxy Adapter for Mastyf Security Gateway
Intercepts MCP tools/call JSON-RPC messages and applies deterministic CBAC/DIFC and AIA auditing.
"""

from typing import Dict, Any, Optional, Callable, Awaitable
import uuid
import time
from ..models import ToolCallRequest, GatewayDecision
from ..gateway import MastyfGateway

class MCPGatewayAdapter:
    """Proxies and audits Model Context Protocol tool invocations."""

    def __init__(self, gateway: MastyfGateway):
        self.gateway = gateway

    async def handle_mcp_call(
        self,
        mcp_payload: Dict[str, Any],
        principal_id: str = "mcp_client",
        session_id: Optional[str] = None,
        tool_executor: Optional[Callable[[str, Dict[str, Any]], Awaitable[Any]]] = None
    ) -> Dict[str, Any]:
        """
        Parses an incoming MCP tools/call JSON-RPC payload:
        {
          "jsonrpc": "2.0",
          "id": "1",
          "method": "tools/call",
          "params": {
            "name": "tool_name",
            "arguments": {...}
          }
        }
        """
        rpc_id = mcp_payload.get("id", str(uuid.uuid4()))
        params = mcp_payload.get("params", {})
        tool_name = params.get("name", "")
        tool_args = params.get("arguments", {})

        session = session_id or f"mcp-session-{rpc_id}"

        req = ToolCallRequest(
            request_id=str(rpc_id),
            session_id=session,
            principal_id=principal_id,
            user_intent=params.get("user_intent", f"Invoke {tool_name}"),
            tool_name=tool_name,
            tool_args=tool_args,
            retrieved_context=params.get("context", "None")
        )

        decision = await self.gateway.evaluate_async(req)

        if not decision.execution_permitted:
            return {
                "jsonrpc": "2.0",
                "id": rpc_id,
                "error": {
                    "code": -32000,
                    "message": f"Mastyf Gateway Denied Tool Execution: {decision.final_decision} ({decision.reason_code})",
                    "data": {
                        "decision": decision.final_decision,
                        "reason_code": decision.reason_code,
                        "arguments_hash": decision.arguments_hash,
                        "invariant_violation": decision.invariant_violation
                    }
                }
            }

        # If an underlying executor is provided, run it
        if tool_executor:
            try:
                res = await tool_executor(tool_name, tool_args)
                self.gateway.difc.record_tool_result(session, tool_name)
                return {
                    "jsonrpc": "2.0",
                    "id": rpc_id,
                    "result": {
                        "content": [{"type": "text", "text": str(res)}],
                        "isError": False
                    }
                }
            except Exception as e:
                return {
                    "jsonrpc": "2.0",
                    "id": rpc_id,
                    "error": {"code": -32603, "message": f"Tool Runtime Error: {str(e)}"}
                }

        # Otherwise return evaluation pass
        return {
            "jsonrpc": "2.0",
            "id": rpc_id,
            "result": {
                "status": "APPROVED",
                "decision": decision.final_decision,
                "arguments_hash": decision.arguments_hash
            }
        }
