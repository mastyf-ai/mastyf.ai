"""
Mastyf Capability-Based Access Control (CBAC) Engine
Deterministic reference monitor for validating tool capabilities, arguments, and principal bounds.
"""

from typing import Dict, List, Optional, Any, Tuple
import time
import re
from .schemas import PolicyDocument, CapabilityDefinition, ArgumentConstraint
from ..models import ToolCallRequest, CBACDecision

class CBACEngine:
    """Deterministic, sub-millisecond capability matching and argument validation engine."""

    def __init__(self, policy: Optional[PolicyDocument] = None):
        self.policy: Optional[PolicyDocument] = policy
        self._capabilities_by_tool: Dict[str, List[CapabilityDefinition]] = {}
        if policy:
            self._index_policy(policy)

    def load_policy(self, policy: PolicyDocument) -> None:
        """Loads and indexes a capability policy document."""
        self.policy = policy
        self._index_policy(policy)

    def _index_policy(self, policy: PolicyDocument) -> None:
        self._capabilities_by_tool = {}
        for cap in policy.capabilities:
            if cap.tool_name not in self._capabilities_by_tool:
                self._capabilities_by_tool[cap.tool_name] = []
            self._capabilities_by_tool[cap.tool_name].append(cap)

    def evaluate(self, req: ToolCallRequest) -> CBACDecision:
        """
        Deterministically evaluates whether the tool call is permitted by capability policy.
        Fails closed on missing policies, unknown tools, unauthorized principals, or invalid arguments.
        """
        start_time = time.perf_counter()

        if self.policy is None:
            elapsed_ms = (time.perf_counter() - start_time) * 1000.0
            return CBACDecision(
                allowed=False,
                reason_code="CBAC_NO_POLICY_LOADED",
                latency_ms=elapsed_ms
            )

        matching_caps = self._capabilities_by_tool.get(req.tool_name, [])
        if not matching_caps:
            elapsed_ms = (time.perf_counter() - start_time) * 1000.0
            return CBACDecision(
                allowed=False,
                policy_id=self.policy.policy_id,
                reason_code="CBAC_UNKNOWN_TOOL",
                latency_ms=elapsed_ms
            )

        # Check each capability candidate for this tool
        for cap in matching_caps:
            # 1. Principal check
            if "*" not in cap.allowed_principals and req.principal_id not in cap.allowed_principals:
                continue

            # 2. Argument validation
            valid, err_code = self._validate_arguments(cap, req.tool_args)
            if not valid:
                elapsed_ms = (time.perf_counter() - start_time) * 1000.0
                return CBACDecision(
                    allowed=False,
                    capability_name=cap.capability_name,
                    policy_id=self.policy.policy_id,
                    reason_code=err_code,
                    latency_ms=elapsed_ms
                )

            # Match found and all constraints satisfied
            elapsed_ms = (time.perf_counter() - start_time) * 1000.0
            return CBACDecision(
                allowed=True,
                capability_name=cap.capability_name,
                policy_id=self.policy.policy_id,
                reason_code="CBAC_OK",
                latency_ms=elapsed_ms
            )

        # Principal did not match any capability
        elapsed_ms = (time.perf_counter() - start_time) * 1000.0
        return CBACDecision(
            allowed=False,
            policy_id=self.policy.policy_id,
            reason_code="CBAC_UNAUTHORIZED_PRINCIPAL",
            latency_ms=elapsed_ms
        )

    def _validate_arguments(self, cap: CapabilityDefinition, args: Dict[str, Any]) -> tuple[bool, str]:
        # Check required fields
        for arg_name, constraint in cap.argument_constraints.items():
            if constraint.required and arg_name not in args:
                return False, f"CBAC_MISSING_REQUIRED_ARG_{arg_name.upper()}"

        # Validate provided arguments against constraints
        for arg_name, arg_val in args.items():
            if arg_name in cap.argument_constraints:
                constraint = cap.argument_constraints[arg_name]
                ok, reason = constraint.validate_value(arg_val)
                if not ok:
                    return False, f"CBAC_ARGUMENT_VIOLATION_{arg_name.upper()}"

            # Check deny patterns
            if arg_name in cap.deny_patterns and isinstance(arg_val, str):
                for pattern in cap.deny_patterns[arg_name]:
                    if re.search(pattern, arg_val, re.IGNORECASE):
                        return False, f"CBAC_DENY_PATTERN_MATCHED_{arg_name.upper()}"

        return True, "OK"
