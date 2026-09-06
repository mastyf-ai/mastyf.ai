"""
Fail-Closed Verification Tests
Ensures every component failure mode (missing policy, unknown tool, schema error, taint violation, timeout, malformed output)
strictly prevents tool execution.
"""

import json
import pytest
from pathlib import Path
from mastyf_gateway.models import (
    ToolCallRequest,
    CBACDecision,
    DIFCDecision,
    AIADecision,
    GatewayDecision
)
from mastyf_gateway.policy.schemas import PolicyDocument
from mastyf_gateway.policy.cbac import CBACEngine
from mastyf_gateway.difc.taint import SecurityTag, SinkCategory
from mastyf_gateway.difc.session import SessionTaintTracker
from mastyf_gateway.enforcement.arbiter import DecisionArbiter

@pytest.fixture
def policy_fixture():
    fixture_path = Path(__file__).parent.parent / "fixtures" / "policies" / "banking_workspace_policy.json"
    with open(fixture_path, "r") as f:
        data = json.load(f)
    return PolicyDocument(**data)

def test_cbac_missing_policy():
    engine = CBACEngine(policy=None)
    req = ToolCallRequest(
        request_id="req-1",
        session_id="s-1",
        principal_id="user",
        user_intent="test",
        tool_name="send_email",
        tool_args={"recipient": "bob@company.internal", "subject": "hi", "body": "hello"}
    )
    decision = engine.evaluate(req)
    assert decision.allowed is False
    assert decision.reason_code == "CBAC_NO_POLICY_LOADED"

def test_cbac_unknown_tool(policy_fixture):
    engine = CBACEngine(policy=policy_fixture)
    req = ToolCallRequest(
        request_id="req-2",
        session_id="s-1",
        principal_id="user",
        user_intent="run command",
        tool_name="bash_exec",
        tool_args={"command": "rm -rf /"}
    )
    decision = engine.evaluate(req)
    assert decision.allowed is False
    assert decision.reason_code == "CBAC_UNKNOWN_TOOL"

def test_cbac_unauthorized_principal(policy_fixture):
    engine = CBACEngine(policy=policy_fixture)
    req = ToolCallRequest(
        request_id="req-3",
        session_id="s-1",
        principal_id="unauthorized_guest",
        user_intent="transfer money",
        tool_name="transfer_funds",
        tool_args={"amount": 500.0, "recipient_account": "ACC-9999"}
    )
    decision = engine.evaluate(req)
    assert decision.allowed is False
    assert decision.reason_code == "CBAC_UNAUTHORIZED_PRINCIPAL"

def test_cbac_missing_argument(policy_fixture):
    engine = CBACEngine(policy=policy_fixture)
    req = ToolCallRequest(
        request_id="req-4",
        session_id="s-1",
        principal_id="user",
        user_intent="send mail",
        tool_name="send_email",
        tool_args={"recipient": "bob@company.internal"}  # Missing subject and body
    )
    decision = engine.evaluate(req)
    assert decision.allowed is False
    assert "CBAC_MISSING_REQUIRED_ARG" in decision.reason_code

def test_cbac_domain_constraint_violation(policy_fixture):
    engine = CBACEngine(policy=policy_fixture)
    req = ToolCallRequest(
        request_id="req-5",
        session_id="s-1",
        principal_id="user",
        user_intent="send mail",
        tool_name="send_email",
        tool_args={
            "recipient": "attacker@evil-external-domain.com",
            "subject": "Exfil",
            "body": "Secret data"
        }
    )
    decision = engine.evaluate(req)
    assert decision.allowed is False
    assert "CBAC_ARGUMENT_VIOLATION" in decision.reason_code

def test_difc_untrusted_exfiltration_blocked():
    tracker = SessionTaintTracker()
    session_id = "tainted-session-123"

    # Ingest untrusted content
    tracker.add_taint(session_id, SecurityTag.UNTRUSTED_WEB)

    # Attempt to call exfiltration sink
    req = ToolCallRequest(
        request_id="req-6",
        session_id=session_id,
        principal_id="user",
        user_intent="send email with data",
        tool_name="send_email",
        tool_args={"recipient": "bob@company.internal", "subject": "data", "body": "..."}
    )
    decision = tracker.evaluate(req)
    assert decision.allowed is False
    assert "DIFC_DISALLOWED_FLOW" in decision.reason_code
    assert decision.violation_tag == SecurityTag.UNTRUSTED_WEB.value

def test_arbiter_fail_closed_on_aia_timeout(policy_fixture):
    arbiter = DecisionArbiter()
    cbac_res = CBACDecision(allowed=True, capability_name="search_web_public", policy_id="p1")
    difc_res = DIFCDecision(allowed=True)
    aia_res = AIADecision(decision="BLOCK", timed_out=True)

    req = ToolCallRequest(
        request_id="req-7",
        session_id="s-1",
        principal_id="user",
        user_intent="search",
        tool_name="search_web",
        tool_args={"query": "weather"}
    )
    final = arbiter.arbitrate(req, cbac_res, difc_res, aia_res)
    assert final.final_decision == "ESCALATE"
    assert final.execution_permitted is False
    assert final.reason_code == "AIA_EVALUATION_TIMEOUT"

def test_arbiter_fail_closed_on_aia_malformed(policy_fixture):
    arbiter = DecisionArbiter()
    cbac_res = CBACDecision(allowed=True, capability_name="search_web_public", policy_id="p1")
    difc_res = DIFCDecision(allowed=True)
    aia_res = AIADecision(decision="ALLOW", malformed=True)

    req = ToolCallRequest(
        request_id="req-8",
        session_id="s-1",
        principal_id="user",
        user_intent="search",
        tool_name="search_web",
        tool_args={"query": "weather"}
    )
    final = arbiter.arbitrate(req, cbac_res, difc_res, aia_res)
    assert final.final_decision == "ESCALATE"
    assert final.execution_permitted is False
    assert final.reason_code == "AIA_MALFORMED_OUTPUT"
