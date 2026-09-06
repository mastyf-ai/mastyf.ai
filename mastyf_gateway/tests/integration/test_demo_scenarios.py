"""
Tests for mastyf demo command and the 5 canonical action boundary scenarios.
Verifies the reference monitor execution invariant:
BackendExecutionCount > 0 ⇒ Decision == ALLOW
"""

import pytest
from mastyf_gateway.demo import SCENARIOS, run_single_demo

@pytest.mark.asyncio
async def test_demo_all_five_scenarios():
    for scenario_id in [1, 2, 3, 4, 5]:
        passed = await run_single_demo(scenario_id)
        assert passed is True, f"Scenario {scenario_id} failed execution invariant"

@pytest.mark.asyncio
async def test_demo_non_allow_zero_executions():
    """Confirms that scenarios 1, 2, 3, and 4 yield zero backend executions."""
    for scenario_id in [1, 2, 3, 4]:
        sc = SCENARIOS[scenario_id]
        assert sc["backend_expected"] == 0
        assert sc["arbiter_decision"] in ["BLOCK", "ESCALATE"]
