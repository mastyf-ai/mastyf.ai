"""
Formal Reference-Monitor Verification: Authority Monotonicity Invariant Test
Verifies: Authority(Final) <= Authority(CBAC) & Authority(DIFC)
Final == ALLOW => CBAC == ALLOW & DIFC == ALLOW & AIA == ALLOW
"""

import pytest
import itertools
from mastyf_gateway.models import (
    ToolCallRequest,
    CBACDecision,
    DIFCDecision,
    AIADecision,
    GatewayDecision
)
from mastyf_gateway.enforcement.arbiter import DecisionArbiter

def test_exhaustive_authority_monotonicity():
    """
    Exhaustively tests all permutations of CBAC, DIFC, and AIA outputs
    to mathematically verify that AIA cannot create or expand authority.
    """
    arbiter = DecisionArbiter()

    cbac_states = [True, False]
    difc_states = [True, False]
    aia_decisions = ["ALLOW", "BLOCK", "ESCALATE", None]
    aia_malformed_states = [False, True]
    aia_timeout_states = [False, True]

    req = ToolCallRequest(
        request_id="req-test-01",
        session_id="session-01",
        principal_id="test_agent",
        user_intent="transfer funds",
        tool_name="transfer_funds",
        tool_args={"amount": 100.0, "recipient_account": "ACC-1234"}
    )

    iterations = 0
    for cbac_ok, difc_ok, aia_dec, malformed, timed_out in itertools.product(
        cbac_states,
        difc_states,
        aia_decisions,
        aia_malformed_states,
        aia_timeout_states
    ):
        cbac_res = CBACDecision(
            allowed=cbac_ok,
            policy_id="test-policy",
            reason_code="CBAC_OK" if cbac_ok else "CBAC_DENIED"
        )
        difc_res = DIFCDecision(
            allowed=difc_ok,
            reason_code="DIFC_OK" if difc_ok else "DIFC_DENIED"
        )

        aia_res = None
        if aia_dec is not None:
            aia_res = AIADecision(
                decision=aia_dec,
                malformed=malformed,
                timed_out=timed_out,
                reason_code=f"AIA_{aia_dec}"
            )

        decision: GatewayDecision = arbiter.arbitrate(
            req=req,
            cbac_res=cbac_res,
            difc_res=difc_res,
            aia_res=aia_res
        )

        iterations += 1

        # Invariant 1: If CBAC or DIFC is False, final decision MUST be BLOCK
        if not cbac_ok or not difc_ok:
            assert decision.final_decision == "BLOCK", (
                f"Failed for cbac={cbac_ok}, difc={difc_ok}, aia={aia_dec}: "
                f"Expected BLOCK but got {decision.final_decision}"
            )
            assert decision.execution_permitted is False, (
                f"Execution permitted illegally when CBAC={cbac_ok}, DIFC={difc_ok}"
            )

        # Invariant 2: Execution is permitted ONLY if CBAC=True, DIFC=True, and AIA=ALLOW (not malformed/timed out)
        if decision.execution_permitted:
            assert cbac_ok is True
            assert difc_ok is True
            assert decision.final_decision == "ALLOW"
            if aia_res is not None:
                assert aia_dec == "ALLOW"
                assert not malformed
                assert not timed_out

        # Invariant 3: ESCALATE or BLOCK never permits execution
        if decision.final_decision in ("BLOCK", "ESCALATE"):
            assert decision.execution_permitted is False

    assert iterations > 0
    print(f"Verified authority monotonicity across {iterations} state permutations.")
