"""
Self-Test Canary Suite Test
Asserts that the self-test canary verifies all 4 authorization paths and strictly preserves:
Decision in {BLOCK, ESCALATE} => BackendToolInvocations == 0
"""

import asyncio
from mastyf_gateway.self_test import execute_self_test_suite

def test_self_test_canary_invariants():
    results = asyncio.run(execute_self_test_suite())
    
    assert results["invariants_passed"] is True
    assert results["backend_executions"]["allowed"] == 1
    assert results["backend_executions"]["blocked"] == 0
    assert results["backend_executions"]["escalated"] == 0
    assert results["backend_executions"]["total"] == 1
    
    for canary in results["canaries"]:
        assert canary["status"] == "PASS"
