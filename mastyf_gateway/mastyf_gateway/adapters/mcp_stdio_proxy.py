"""
Mastyf Model Context Protocol (MCP) Stdio Reverse Proxy.

Provides zero-code-change execution boundary interception for MCP servers:
  MCP Client (Claude Desktop / Cursor) <--- stdio ---> Mastyf Proxy <--- stdio ---> Child MCP Server

Enforces:
  1. Passthrough of lifecycle & discovery messages (initialize, ping, tools/list).
  2. Interception of tools/call requests against compiled CBAC + DIFC + AIA policy.
  3. Strict zero-byte transport non-delivery on non-ALLOW (BLOCK / ESCALATE).
  4. Single-reader child stdout response dispatcher with request-ID correlation table.
  5. Clean error semantics (-32700 parse, -32001 policy violation, -32603 internal).
"""

from __future__ import annotations

import asyncio
import json
import sys
import uuid
import time
from typing import Any, Dict, List, Optional, Union

from ..models import ToolCallRequest, GatewayDecision
from ..gateway import MastyfGateway
from ..receipts import ExecutionReceiptLedger, ExecutionObservation


class MCPStdioProxy:
    """
    Asynchronous stdio reverse proxy for MCP tool execution mediation.
    """

    def __init__(
        self,
        gateway: MastyfGateway,
        child_cmd: List[str],
        session_id: Optional[str] = None,
        principal_id: str = "mcp_client",
        timeout_seconds: float = 30.0,
        ledger: Optional[ExecutionReceiptLedger] = None,
    ):
        self.gateway = gateway
        self.child_cmd = list(child_cmd)
        self.session_id = session_id or f"mcp-session-{uuid.uuid4().hex[:8]}"
        self.principal_id = principal_id
        self.timeout_seconds = timeout_seconds
        self.ledger = ledger or ExecutionReceiptLedger()

        self.process: Optional[asyncio.subprocess.Process] = None
        self.pending: Dict[Any, asyncio.Future[Dict[str, Any]]] = {}
        self._reader_task: Optional[asyncio.Task] = None
        self._running: bool = False
        self._child_bytes_written: int = 0

    @property
    def child_bytes_written(self) -> int:
        """Total raw bytes dispatched to child process stdin."""
        return self._child_bytes_written

    async def start(self) -> None:
        """Spawns the child MCP server process and starts the stdout dispatcher."""
        if not self.child_cmd:
            raise ValueError("No child command specified for MCP proxy.")

        self.process = await asyncio.create_subprocess_exec(
            *self.child_cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=sys.stderr,
        )
        self._running = True
        self._reader_task = asyncio.create_task(self._child_stdout_dispatcher())

    async def _child_stdout_dispatcher(self) -> None:
        """
        Single-reader loop for child process stdout.
        Correlates responses with active pending request IDs to eliminate concurrency races.
        """
        assert self.process and self.process.stdout is not None
        try:
            while self._running:
                line_bytes = await self.process.stdout.readline()
                if not line_bytes:
                    # Child closed stdout (EOF)
                    break

                line = line_bytes.decode("utf-8", errors="replace").strip()
                if not line:
                    continue

                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    continue

                req_id = msg.get("id")
                if req_id is not None and req_id in self.pending:
                    fut = self.pending.pop(req_id)
                    if not fut.done():
                        fut.set_result(msg)
                else:
                    # Server notification or unsolicted message; nothing to correlate
                    pass
        except asyncio.CancelledError:
            pass
        except Exception:
            pass
        finally:
            # Drain any remaining pending futures on unexpected child termination
            for req_id, fut in list(self.pending.items()):
                if not fut.done():
                    fut.set_exception(RuntimeError("Child MCP server terminated unexpectedly"))
            self.pending.clear()

    async def process_message(self, raw_line: str) -> Optional[Dict[str, Any]]:
        """
        Processes a single incoming client message string.
        Returns a response dictionary if a response should be sent to the client,
        or None if no client response is required (e.g. notifications).
        """
        # 1. Parse JSON framing
        raw_stripped = raw_line.strip()
        if not raw_stripped:
            return None

        try:
            payload = json.loads(raw_stripped)
        except json.JSONDecodeError as exc:
            # Transport invariant: malformed JSON receives -32700, 0 bytes to child
            return {
                "jsonrpc": "2.0",
                "id": None,
                "error": {
                    "code": -32700,
                    "message": f"Parse error: invalid JSON ({str(exc)})",
                },
            }

        if not isinstance(payload, dict):
            return {
                "jsonrpc": "2.0",
                "id": None,
                "error": {
                    "code": -32600,
                    "message": "Invalid Request: expected JSON-RPC object",
                },
            }

        req_id = payload.get("id")
        method = payload.get("method")
        params = payload.get("params", {}) or {}

        # 2. Distinguish JSON-RPC Notifications (no id) from Requests (has id)
        is_notification = req_id is None

        # 3. Notification Handling
        if is_notification:
            # Notifications are never tracked in pending table.
            # Passthrough non-tool notifications directly to child.
            if self.process and self.process.stdin:
                payload_bytes = (json.dumps(payload) + "\n").encode("utf-8")
                self.process.stdin.write(payload_bytes)
                await self.process.stdin.drain()
                self._child_bytes_written += len(payload_bytes)
            return None

        # 4. Non-tool request passthrough (initialize, ping, tools/list, prompts/list, etc.)
        if method != "tools/call":
            return await self._forward_request_to_child(payload, req_id)

        # 5. Intercept tools/call: Capability, Flow, and Intent Verification
        tool_name = params.get("name", "")
        tool_args = params.get("arguments", {})
        if not isinstance(tool_args, dict):
            tool_args = {}

        req = ToolCallRequest(
            request_id=str(req_id),
            session_id=self.session_id,
            principal_id=self.principal_id,
            user_intent=params.get("user_intent", f"Execute tool {tool_name}"),
            tool_name=tool_name,
            tool_args=tool_args,
            retrieved_context=params.get("context", "None"),
        )

        decision: GatewayDecision = await self.gateway.evaluate_async(req)

        # 6. Evaluation Branch
        if decision.execution_permitted:
            # ALLOW: Forward request to child stdin and await correlated response
            resp = await self._forward_request_to_child(payload, req_id)
            if resp and "result" in resp:
                # Record successful tool execution for DIFC state tracking
                self.gateway.difc.record_tool_result(self.session_id, tool_name)
                obs = ExecutionObservation.RESPONSE_RECEIVED
            else:
                # Child errored or timed out after dispatch
                obs = ExecutionObservation.SENT_CHILD_NO_RESPONSE

            # Commit or handle outcome in workflow engine
            self.gateway.workflow.commit_outcome(self.session_id, tool_name, obs, request_id=str(req_id))

            self.ledger.record(
                request_id=str(req_id),
                session_id=self.session_id,
                principal_id=self.principal_id,
                tool_name=tool_name,
                tool_args=tool_args,
                policy_id=decision.policy_id or "default-policy",
                policy_obj=self.gateway.policy,
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
                execution_certainty="KNOWN" if obs == ExecutionObservation.RESPONSE_RECEIVED else "UNKNOWN",
            )
            return resp

        # NON-ALLOW (BLOCK or ESCALATE):
        # CRITICAL INVARIANT: Exactly zero bytes written to child stdin!
        self.gateway.workflow.commit_outcome(self.session_id, tool_name, ExecutionObservation.NOT_SENT, request_id=str(req_id))
        self.ledger.record(
            request_id=str(req_id),
            session_id=self.session_id,
            principal_id=self.principal_id,
            tool_name=tool_name,
            tool_args=tool_args,
            policy_id=decision.policy_id or "default-policy",
            policy_obj=self.gateway.policy,
            cbac_decision="ALLOW" if decision.cbac_allowed else "DENY",
            difc_decision="ALLOW" if decision.difc_allowed else "BLOCK",
            aia_decision=decision.aia_decision or "NOT_EVALUATED",
            arbiter_decision=decision.final_decision,
            execution_observation=ExecutionObservation.NOT_SENT,
            reason_code=decision.reason_code,
            workflow_id=decision.workflow_id,
            workflow_state_before=decision.workflow_state_before,
            workflow_transition=None,
            workflow_state_after=decision.workflow_state_before,
            workflow_rule=decision.workflow_rule,
            execution_certainty=decision.execution_certainty,
        )

        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {
                "code": -32001,
                "message": "MCP tool execution denied by Mastyf policy",
                "data": {
                    "decision": decision.final_decision,
                    "reason_code": decision.reason_code,
                    "arguments_hash": decision.arguments_hash,
                    "invariant_violation": decision.invariant_violation,
                },
            },
        }

    async def _forward_request_to_child(self, payload: Dict[str, Any], req_id: Any) -> Dict[str, Any]:
        """
        Registers request in correlation table, writes to child stdin, and awaits response.
        """
        if not self.process or not self.process.stdin:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {
                    "code": -32603,
                    "message": "Internal error: child MCP server is not running",
                },
            }

        loop = asyncio.get_running_loop()
        fut: asyncio.Future[Dict[str, Any]] = loop.create_future()
        self.pending[req_id] = fut

        try:
            payload_bytes = (json.dumps(payload) + "\n").encode("utf-8")
            self.process.stdin.write(payload_bytes)
            await self.process.stdin.drain()
            self._child_bytes_written += len(payload_bytes)

            # Wait for correlated response from single-reader dispatcher
            response = await asyncio.wait_for(fut, timeout=self.timeout_seconds)
            return response
        except asyncio.TimeoutError:
            self.pending.pop(req_id, None)
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {
                    "code": -32603,
                    "message": f"Child MCP server timed out after {self.timeout_seconds}s",
                },
            }
        except RuntimeError as e:
            self.pending.pop(req_id, None)
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {
                    "code": -32603,
                    "message": f"Child MCP execution error: {str(e)}",
                },
            }

    async def run(
        self,
        reader: Optional[asyncio.StreamReader] = None,
        writer: Optional[asyncio.StreamWriter] = None,
    ) -> None:
        """
        Runs proxy stdio loop until client EOF or cancellation.
        """
        await self.start()

        try:
            if reader is None:
                # Wrap stdin
                loop = asyncio.get_running_loop()
                reader = asyncio.StreamReader()
                protocol = asyncio.StreamReaderProtocol(reader)
                await loop.connect_read_pipe(lambda: protocol, sys.stdin)

            while self._running:
                line_bytes = await reader.readline()
                if not line_bytes:
                    # Client closed stdin (EOF)
                    break

                line = line_bytes.decode("utf-8", errors="replace")
                resp = await self.process_message(line)
                if resp is not None:
                    out_str = json.dumps(resp) + "\n"
                    if writer:
                        writer.write(out_str.encode("utf-8"))
                        await writer.drain()
                    else:
                        sys.stdout.write(out_str)
                        sys.stdout.flush()
        finally:
            await self.close()

    async def close(self) -> None:
        """Terminates proxy, cleans up dispatcher, and stops child process."""
        self._running = False

        if self._reader_task and not self._reader_task.done():
            self._reader_task.cancel()
            try:
                await self._reader_task
            except asyncio.CancelledError:
                pass

        if self.process:
            if self.process.stdin:
                try:
                    self.process.stdin.close()
                    await self.process.stdin.wait_closed()
                except Exception:
                    pass

            if self.process.returncode is None:
                try:
                    self.process.terminate()
                    await asyncio.wait_for(self.process.wait(), timeout=2.0)
                except Exception:
                    try:
                        self.process.kill()
                    except Exception:
                        pass
