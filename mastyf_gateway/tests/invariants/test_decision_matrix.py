"""
Decision Matrix Verification Tests
Explicitly verifies the canonical 7-row decision matrix requested in the gateway security specification.
"""

import pytest
from mastyf_gateway.models import (
    ToolCallRequest,
    CBACDecision,
    DIFCDecision,
    AIADecision,
    GatewayDecision
)
from mastyf_gateway.enforcement.arbiter import DecisionArbiter

@pytest.mark.parametrize("cbac_ok,difc_ok,aia_dec,timed_out,malformed,expected_final,expected_exec", [
    (False, True, "ALLOW", False, False, "BLOCK", False),
    (False, False, "ALLOW", False, False, "BLOCK", False),
    (True, False, "ALLOW", False, False, "BLOCK", False),
    (True, True, "BLOCK", False, False, "BLOCK", False),
    (True, True, "ESCALATE", False, False, "ESCALATE", False),
    (True, True, "ALLOW", False, False, "ALLOW", True),
    (True, True, "ALLOW", True, False, "ESCALATE", False),
    (True, True, "ALLOW", False, True, "ESCALATE", False),
])
def test_canonical_decision_matrix(
    cbac_ok, difc_ok, aia_dec, timed_out, malformed, expected_final, expected_exec
):
    arbiter = DecisionArbiter()
    req = ToolCallRequest(
        request_id="matrix-test-req",
        session_id="matrix-session",
        principal_id="test_principal",
        user_intent="test intent",
        tool_name="test_tool",
        tool_args={"key": "value"}
    )
    cbac_res = CBACDecision(allowed=cbac_ok, policy_id="p1", reason_code="CBAC_OK" if cbac_ok else "CBAC_DENY")
    difc_res = DIFCDecision(allowed=difc_ok, reason_code="DIFC_OK" if difc_ok else "DIFC_DENY")
    aia_res = AIADecision(decision=aia_dec, timed_out=timed_out, malformed=malformed)

    decision = arbiter.arbitrate(req, cbac_res, difc_res, aia_res)
    assert decision.final_decision == expected_final
    assert decision.execution_permitted == expected_exec
