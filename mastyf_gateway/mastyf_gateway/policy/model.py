"""
Declarative Mastyf Policy Data Models and Runtime Compilation Types.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Optional, Dict, Tuple, List

from .schemas import (
    PolicyDocument as GatewayPolicyDocument,
    CapabilityDefinition as GatewayCapabilityDefinition,
    ArgumentConstraint as GatewayArgumentConstraint,
)

@dataclass(frozen=True)
class Constraint:
    type: str = "string"
    pattern: Optional[str] = None
    allowed_values: Tuple[Any, ...] = ()

@dataclass(frozen=True)
class CapabilityRule:
    tool: str
    actions: Tuple[str, ...] = ()
    allowed_principals: Tuple[str, ...] = ()
    constraints: Dict[str, Constraint] = field(default_factory=dict)

@dataclass(frozen=True)
class TaintRule:
    tag: str
    sources: Tuple[str, ...] = ()
    denied_sinks: Tuple[str, ...] = ()

@dataclass(frozen=True)
class InformationFlowRule:
    taints: Tuple[TaintRule, ...] = ()

@dataclass(frozen=True)
class RuleSettings:
    deny_privilege_escalation: bool = True
    fail_closed: bool = True
    require_audit_for: Tuple[str, ...] = ()

@dataclass(frozen=True)
class WorkflowTransition:
    from_state: str
    on_tool: str
    to_state: str

@dataclass(frozen=True)
class WorkflowConstraint:
    when_state: Optional[str] = None
    when_execution_certainty: Optional[str] = None
    deny: Tuple[str, ...] = ()
    reason: str = ""

@dataclass(frozen=True)
class CannotFollowRule:
    trigger: str
    forbidden: Tuple[str, ...] = ()

@dataclass(frozen=True)
class RequiresStateRule:
    tool: str
    state: str

@dataclass(frozen=True)
class MaxOccurrencesRule:
    tool: str
    count: int
    scope: str = "session"

@dataclass(frozen=True)
class WorkflowDefinition:
    name: str
    scope: str = "session"
    initial_state: str = "CLEAN"
    states: Tuple[str, ...] = ()
    transitions: Tuple[WorkflowTransition, ...] = ()
    constraints: Tuple[WorkflowConstraint, ...] = ()
    cannot_follow: Tuple[CannotFollowRule, ...] = ()
    requires_state: Tuple[RequiresStateRule, ...] = ()
    max_occurrences: Tuple[MaxOccurrencesRule, ...] = ()

@dataclass(frozen=True)
class PolicyDocument:
    id: str
    version: str = "1.0"
    description: str = ""
    capabilities: Tuple[CapabilityRule, ...] = ()
    information_flow: InformationFlowRule = field(default_factory=InformationFlowRule)
    rules: RuleSettings = field(default_factory=RuleSettings)
    workflows: Tuple[WorkflowDefinition, ...] = ()

@dataclass(frozen=True)
class CompiledPolicy:
    policy: PolicyDocument
    cbac: Dict[str, Dict[str, Any]]
    difc: Dict[str, Dict[str, List[str]]]
    rules: Dict[str, Any]
    workflows: Dict[str, Any] = field(default_factory=dict)

    def as_runtime_config(self) -> Dict[str, Any]:
        return {
            "policy_id": self.policy.id,
            "version": self.policy.version,
            "description": self.policy.description,
            "cbac": self.cbac,
            "difc": self.difc,
            "rules": self.rules,
            "workflows": self.workflows,
        }

    def to_gateway_policy(self) -> GatewayPolicyDocument:
        """
        Compiles the declarative representation into the existing runtime
        schemas.PolicyDocument utilized by CBACEngine.
        """
        caps: List[GatewayCapabilityDefinition] = []
        for rule in self.policy.capabilities:
            arg_constraints: Dict[str, GatewayArgumentConstraint] = {}
            for name, spec in rule.constraints.items():
                arg_constraints[name] = GatewayArgumentConstraint(
                    required=False,
                    expected_type=spec.type,
                    pattern=spec.pattern,
                    allowed_values=list(spec.allowed_values) if spec.allowed_values else None,
                )
            caps.append(
                GatewayCapabilityDefinition(
                    capability_name=f"{rule.tool}_cap",
                    tool_name=rule.tool,
                    description=f"Declaratively authorized capability for {rule.tool}",
                    allowed_principals=list(rule.allowed_principals) if rule.allowed_principals else ["*"],
                    argument_constraints=arg_constraints,
                )
            )

        return GatewayPolicyDocument(
            policy_id=self.policy.id,
            version=self.policy.version,
            description=self.policy.description,
            capabilities=caps,
        )
