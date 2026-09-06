"""
Tests for Mastyf Declarative Policy Engine (Phase 1)
"""

import pytest
import tempfile
from pathlib import Path

from mastyf_gateway.policy.loader import (
    load_policy,
    validate_policy,
    compile_policy,
    PolicyError,
)
from mastyf_gateway.policy.cli import (
    cmd_policy_init,
    cmd_policy_validate,
    STARTER_POLICY,
)
from mastyf_gateway.policy.cbac import CBACEngine
from mastyf_gateway.models import ToolCallRequest


def test_starter_policy_compilation():
    with tempfile.NamedTemporaryFile(suffix=".yaml", mode="w", delete=False) as f:
        f.write(STARTER_POLICY)
        f_path = f.name

    try:
        policy = validate_policy(f_path)
        assert policy.id == "customer-support-agent"
        assert len(policy.capabilities) == 3

        compiled = compile_policy(policy)
        assert "customer.lookup" in compiled.cbac
        assert "CONFIDENTIAL_PII" in compiled.difc
        assert compiled.rules["fail_closed"] is True

        # Test conversion to gateway CBAC engine
        gw_policy = compiled.to_gateway_policy()
        engine = CBACEngine(gw_policy)

        # Test valid call
        valid_req = ToolCallRequest(
            request_id="test-1",
            session_id="sess-1",
            principal_id="agent",
            user_intent="Lookup customer details",
            tool_name="customer.lookup",
            tool_args={"customer_id": "CUST-1234"}
        )
        dec = engine.evaluate(valid_req)
        assert dec.allowed is True
        assert dec.reason_code == "CBAC_OK"

        # Test invalid argument regex pattern
        invalid_req = ToolCallRequest(
            request_id="test-2",
            session_id="sess-1",
            principal_id="agent",
            user_intent="Lookup customer with bad id",
            tool_name="customer.lookup",
            tool_args={"customer_id": "MALICIOUS_INPUT"}
        )
        dec_inv = engine.evaluate(invalid_req)
        assert dec_inv.allowed is False
        assert dec_inv.reason_code.startswith("CBAC_ARGUMENT_VIOLATION")

    finally:
        Path(f_path).unlink(missing_ok=True)


def test_invalid_regex_rejected():
    invalid_yaml = """id: bad-regex-agent
version: "1.0"
capabilities:
  - tool: test_tool
    actions: [read]
    constraints:
      id:
        type: string
        pattern: "[unclosed_bracket"
"""
    with tempfile.NamedTemporaryFile(suffix=".yaml", mode="w", delete=False) as f:
        f.write(invalid_yaml)
        f_path = f.name

    try:
        with pytest.raises(PolicyError) as exc:
            validate_policy(f_path)
        assert "pattern is invalid" in str(exc.value)
    finally:
        Path(f_path).unlink(missing_ok=True)


def test_duplicate_tool_action_rejected():
    dup_yaml = """id: dup-action-agent
version: "1.0"
capabilities:
  - tool: my_tool
    actions: [read, read]
"""
    with tempfile.NamedTemporaryFile(suffix=".yaml", mode="w", delete=False) as f:
        f.write(dup_yaml)
        f_path = f.name

    try:
        with pytest.raises(PolicyError) as exc:
            validate_policy(f_path)
        assert "duplicate values" in str(exc.value)
    finally:
        Path(f_path).unlink(missing_ok=True)


def test_duplicate_taint_tags_rejected():
    dup_taint_yaml = """id: dup-taint-agent
version: "1.0"
information_flow:
  taints:
    - tag: CONFIDENTIAL
      sources: [read_secret]
      denied_sinks: [external_webhook]
    - tag: CONFIDENTIAL
      sources: [read_database]
      denied_sinks: [public_slack]
"""
    with tempfile.NamedTemporaryFile(suffix=".yaml", mode="w", delete=False) as f:
        f.write(dup_taint_yaml)
        f_path = f.name

    try:
        with pytest.raises(PolicyError) as exc:
            validate_policy(f_path)
        assert "duplicate tags" in str(exc.value)
    finally:
        Path(f_path).unlink(missing_ok=True)


def test_cli_init_and_validate(tmp_path):
    target = tmp_path / "custom-policy.yaml"
    ret = cmd_policy_init(output=str(target))
    assert ret == 0
    assert target.exists()

    # Re-init without force must raise
    with pytest.raises(PolicyError):
        cmd_policy_init(output=str(target), force=False)

    # Re-init with force succeeds
    ret_force = cmd_policy_init(output=str(target), force=True)
    assert ret_force == 0

    # Validate returns 0
    val_ret = cmd_policy_validate(str(target))
    assert val_ret == 0
