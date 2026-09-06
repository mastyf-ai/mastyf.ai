from __future__ import annotations

import re
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover - exercised by packaging checks
    raise RuntimeError("Declarative policies require PyYAML (pip install pyyaml).") from exc

from .model import (
    CapabilityRule,
    CompiledPolicy,
    Constraint,
    InformationFlowRule,
    PolicyDocument,
    RuleSettings,
    TaintRule,
    WorkflowDefinition,
    WorkflowTransition,
    WorkflowConstraint,
    CannotFollowRule,
    RequiresStateRule,
    MaxOccurrencesRule,
)


class PolicyError(ValueError):
    """Raised when a declarative Mastyf policy is invalid."""


def _mapping(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise PolicyError(f"{path} must be a mapping")
    return value


def _string(value: Any, path: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise PolicyError(f"{path} must be a non-empty string")
    return value


def _string_list(value: Any, path: str, *, allow_empty: bool = False) -> tuple[str, ...]:
    if value is None and allow_empty:
        return ()
    if not isinstance(value, list) or (not allow_empty and not value):
        raise PolicyError(f"{path} must be a non-empty list")
    out: list[str] = []
    for i, item in enumerate(value):
        out.append(_string(item, f"{path}[{i}]"))
    if len(set(out)) != len(out):
        raise PolicyError(f"{path} contains duplicate values")
    return tuple(out)


def _constraint(value: Any, path: str) -> Constraint:
    obj = _mapping(value, path)
    ctype = obj.get("type", "string")
    if ctype not in {"string", "integer", "number", "boolean"}:
        raise PolicyError(f"{path}.type has unsupported value {ctype!r}")
    pattern = obj.get("pattern")
    if pattern is not None:
        if not isinstance(pattern, str):
            raise PolicyError(f"{path}.pattern must be a string")
        try:
            re.compile(pattern)
        except re.error as exc:
            raise PolicyError(f"{path}.pattern is invalid: {exc}") from exc
        if ctype != "string":
            raise PolicyError(f"{path}.pattern requires type=string")
    allowed = obj.get("allowed_values", [])
    if allowed is None:
        allowed = ()
    if not isinstance(allowed, list):
        raise PolicyError(f"{path}.allowed_values must be a list")
    if len(allowed) != len({repr(v) for v in allowed}):
        raise PolicyError(f"{path}.allowed_values contains duplicate values")
    if allowed and ctype == "string" and not all(isinstance(v, str) for v in allowed):
        raise PolicyError(f"{path}.allowed_values must contain strings for type=string")
    return Constraint(type=ctype, pattern=pattern, allowed_values=tuple(allowed))


def _capability(value: Any, index: int) -> CapabilityRule:
    path = f"capabilities[{index}]"
    obj = _mapping(value, path)
    tool = _string(obj.get("tool"), f"{path}.tool")
    actions = _string_list(obj.get("actions"), f"{path}.actions")
    principals = _string_list(obj.get("allowed_principals", []), f"{path}.allowed_principals", allow_empty=True)
    raw_constraints = obj.get("constraints", {})
    constraints_obj = _mapping(raw_constraints, f"{path}.constraints")
    constraints = {name: _constraint(spec, f"{path}.constraints.{name}") for name, spec in constraints_obj.items()}
    return CapabilityRule(tool=tool, actions=actions, allowed_principals=principals, constraints=constraints)


def _taint(value: Any, index: int) -> TaintRule:
    path = f"information_flow.taints[{index}]"
    obj = _mapping(value, path)
    return TaintRule(
        tag=_string(obj.get("tag"), f"{path}.tag"),
        sources=_string_list(obj.get("sources"), f"{path}.sources"),
        denied_sinks=_string_list(obj.get("denied_sinks"), f"{path}.denied_sinks"),
    )


def _workflow_transition(value: Any, path: str, declared_states: set[str]) -> WorkflowTransition:
    obj = _mapping(value, path)
    from_state = _string(obj.get("from"), f"{path}.from")
    if declared_states and from_state not in declared_states:
        raise PolicyError(f"{path}.from '{from_state}' is not in declared states")

    on_raw = obj.get("on")
    if on_raw is None and True in obj:
        # PyYAML parses unquoted 'on:' as boolean True
        on_raw = obj[True]

    if isinstance(on_raw, dict):
        on_tool = _string(on_raw.get("tool") or on_raw.get("on_tool"), f"{path}.on.tool")
    elif isinstance(on_raw, str):
        on_tool = _string(on_raw, f"{path}.on")
    elif "on_tool" in obj:
        on_tool = _string(obj.get("on_tool"), f"{path}.on_tool")
    elif "tool" in obj:
        on_tool = _string(obj.get("tool"), f"{path}.tool")
    else:
        raise PolicyError(f"{path} missing transition tool trigger (expected 'on.tool' or 'on')")

    to_state = _string(obj.get("to"), f"{path}.to")
    if declared_states and to_state not in declared_states:
        raise PolicyError(f"{path}.to '{to_state}' is not in declared states")

    return WorkflowTransition(from_state=from_state, on_tool=on_tool, to_state=to_state)


def _workflow_constraint(value: Any, path: str, declared_states: set[str]) -> WorkflowConstraint:
    obj = _mapping(value, path)
    when_state = obj.get("when_state")
    if when_state is not None:
        when_state = _string(when_state, f"{path}.when_state")
        if declared_states and when_state not in declared_states:
            raise PolicyError(f"{path}.when_state '{when_state}' is not in declared states")

    when_cert = obj.get("when_execution_certainty")
    if when_cert is not None:
        when_cert = _string(when_cert, f"{path}.when_execution_certainty")
        if when_cert not in {"KNOWN", "UNKNOWN"}:
            raise PolicyError(f"{path}.when_execution_certainty must be 'KNOWN' or 'UNKNOWN'")

    deny = _string_list(obj.get("deny", []), f"{path}.deny", allow_empty=False)
    reason = str(obj.get("reason", ""))
    return WorkflowConstraint(
        when_state=when_state,
        when_execution_certainty=when_cert,
        deny=deny,
        reason=reason,
    )


def _cannot_follow_rule(value: Any, path: str) -> CannotFollowRule:
    obj = _mapping(value, path)
    trigger = _string(obj.get("trigger"), f"{path}.trigger")
    forbidden = _string_list(obj.get("forbidden", []), f"{path}.forbidden", allow_empty=False)
    return CannotFollowRule(trigger=trigger, forbidden=forbidden)


def _requires_state_rule(value: Any, path: str, declared_states: set[str]) -> RequiresStateRule:
    obj = _mapping(value, path)
    tool = _string(obj.get("tool"), f"{path}.tool")
    state = _string(obj.get("state"), f"{path}.state")
    if declared_states and state not in declared_states:
        raise PolicyError(f"{path}.state '{state}' is not in declared states")
    return RequiresStateRule(tool=tool, state=state)


def _max_occurrences_rule(value: Any, path: str) -> MaxOccurrencesRule:
    obj = _mapping(value, path)
    tool = _string(obj.get("tool"), f"{path}.tool")
    count_val = obj.get("count")
    if not isinstance(count_val, int) or count_val < 0:
        raise PolicyError(f"{path}.count must be a non-negative integer")
    scope = str(obj.get("scope", "session"))
    return MaxOccurrencesRule(tool=tool, count=count_val, scope=scope)


def _workflow(value: Any, index: int) -> WorkflowDefinition:
    path = f"workflows[{index}]"
    obj = _mapping(value, path)
    name = _string(obj.get("name"), f"{path}.name")
    scope = str(obj.get("scope", "session"))
    initial_state = str(obj.get("initial_state", "CLEAN"))
    states = _string_list(obj.get("states", []), f"{path}.states", allow_empty=True)
    declared_states = set(states)
    if declared_states and initial_state not in declared_states:
        raise PolicyError(f"{path}.initial_state '{initial_state}' is not in declared states")

    transitions_raw = obj.get("transitions", [])
    if not isinstance(transitions_raw, list):
        raise PolicyError(f"{path}.transitions must be a list")
    transitions = tuple(
        _workflow_transition(t, f"{path}.transitions[{i}]", declared_states)
        for i, t in enumerate(transitions_raw)
    )

    constraints_raw = obj.get("constraints", [])
    if not isinstance(constraints_raw, list):
        raise PolicyError(f"{path}.constraints must be a list")
    constraints = tuple(
        _workflow_constraint(c, f"{path}.constraints[{i}]", declared_states)
        for i, c in enumerate(constraints_raw)
    )

    cannot_follow_raw = obj.get("cannot_follow", [])
    if isinstance(cannot_follow_raw, dict):
        cannot_follow_raw = [cannot_follow_raw]
    elif not isinstance(cannot_follow_raw, list):
        raise PolicyError(f"{path}.cannot_follow must be a mapping or list of mappings")
    cannot_follow = tuple(
        _cannot_follow_rule(cf, f"{path}.cannot_follow[{i}]")
        for i, cf in enumerate(cannot_follow_raw)
    )

    requires_state_raw = obj.get("requires_state", [])
    if isinstance(requires_state_raw, dict):
        requires_state_raw = [requires_state_raw]
    elif not isinstance(requires_state_raw, list):
        raise PolicyError(f"{path}.requires_state must be a mapping or list of mappings")
    requires_state = tuple(
        _requires_state_rule(rs, f"{path}.requires_state[{i}]", declared_states)
        for i, rs in enumerate(requires_state_raw)
    )

    max_occurrences_raw = obj.get("max_occurrences", [])
    if isinstance(max_occurrences_raw, dict):
        max_occurrences_raw = [max_occurrences_raw]
    elif not isinstance(max_occurrences_raw, list):
        raise PolicyError(f"{path}.max_occurrences must be a mapping or list of mappings")
    max_occurrences = tuple(
        _max_occurrences_rule(mo, f"{path}.max_occurrences[{i}]")
        for i, mo in enumerate(max_occurrences_raw)
    )

    return WorkflowDefinition(
        name=name,
        scope=scope,
        initial_state=initial_state,
        states=states,
        transitions=transitions,
        constraints=constraints,
        cannot_follow=cannot_follow,
        requires_state=requires_state,
        max_occurrences=max_occurrences,
    )


def parse_policy(data: Any) -> PolicyDocument:
    root = _mapping(data, "policy")
    capabilities_raw = root.get("capabilities", [])
    if not isinstance(capabilities_raw, list):
        raise PolicyError("capabilities must be a list")
    caps = tuple(_capability(item, i) for i, item in enumerate(capabilities_raw))
    cap_keys = [(c.tool, a) for c in caps for a in c.actions]
    if len(cap_keys) != len(set(cap_keys)):
        raise PolicyError("capabilities contains duplicate tool/action pairs")

    flow = _mapping(root.get("information_flow", {}), "information_flow")
    taints_raw = flow.get("taints", [])
    if not isinstance(taints_raw, list):
        raise PolicyError("information_flow.taints must be a list")
    taints = tuple(_taint(item, i) for i, item in enumerate(taints_raw))
    tags = [t.tag for t in taints]
    if len(tags) != len(set(tags)):
        raise PolicyError("information_flow.taints contains duplicate tags")

    rules_raw = _mapping(root.get("rules", {}), "rules")
    require_audit = _string_list(rules_raw.get("require_audit_for", []), "rules.require_audit_for", allow_empty=True)
    rules = RuleSettings(
        deny_privilege_escalation=bool(rules_raw.get("deny_privilege_escalation", True)),
        fail_closed=bool(rules_raw.get("fail_closed", True)),
        require_audit_for=require_audit,
    )

    workflows_raw = root.get("workflows", [])
    if not isinstance(workflows_raw, list):
        raise PolicyError("workflows must be a list")
    workflows = tuple(_workflow(item, i) for i, item in enumerate(workflows_raw))
    wf_names = [wf.name for wf in workflows]
    if len(wf_names) != len(set(wf_names)):
        raise PolicyError("workflows contains duplicate workflow names")

    return PolicyDocument(
        id=_string(root.get("id"), "id"),
        version=_string(root.get("version"), "version"),
        description=str(root.get("description", "")),
        capabilities=caps,
        information_flow=InformationFlowRule(taints=taints),
        rules=rules,
        workflows=workflows,
    )


def validate_policy(path: str | Path) -> PolicyDocument:
    source = Path(path)
    if not source.is_file():
        raise PolicyError(f"policy file not found: {source}")
    try:
        data = yaml.safe_load(source.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise PolicyError(f"invalid YAML: {exc}") from exc
    if data is None:
        raise PolicyError("policy file is empty")
    return parse_policy(data)


def load_policy(path: str | Path) -> PolicyDocument:
    return validate_policy(path)


def compile_policy(policy: PolicyDocument) -> CompiledPolicy:
    cbac: dict[str, dict[str, Any]] = {}
    for rule in policy.capabilities:
        cbac_key = rule.tool
        existing = cbac.setdefault(cbac_key, {"actions": {}, "constraints": {}})
        for action in rule.actions:
            existing["actions"][action] = {
                "allowed_principals": list(rule.allowed_principals),
            }
        existing["constraints"].update(
            {
                name: {
                    "type": spec.type,
                    **({"pattern": spec.pattern} if spec.pattern is not None else {}),
                    **({"allowed_values": list(spec.allowed_values)} if spec.allowed_values else {}),
                }
                for name, spec in rule.constraints.items()
            }
        )

    difc = {
        taint.tag: {
            "sources": list(taint.sources),
            "denied_sinks": list(taint.denied_sinks),
        }
        for taint in policy.information_flow.taints
    }
    rules = {
        "deny_privilege_escalation": policy.rules.deny_privilege_escalation,
        "fail_closed": policy.rules.fail_closed,
        "require_audit_for": list(policy.rules.require_audit_for),
    }

    compiled_workflows: dict[str, dict[str, Any]] = {}
    for wf in policy.workflows:
        compiled_workflows[wf.name] = {
            "name": wf.name,
            "scope": wf.scope,
            "initial_state": wf.initial_state,
            "states": list(wf.states),
            "transitions": [
                {"from": t.from_state, "on_tool": t.on_tool, "to": t.to_state}
                for t in wf.transitions
            ],
            "constraints": [
                {
                    "when_state": c.when_state,
                    "when_execution_certainty": c.when_execution_certainty,
                    "deny": list(c.deny),
                    "reason": c.reason,
                }
                for c in wf.constraints
            ],
            "cannot_follow": [
                {"trigger": cf.trigger, "forbidden": list(cf.forbidden)}
                for cf in wf.cannot_follow
            ],
            "requires_state": [
                {"tool": rs.tool, "state": rs.state}
                for rs in wf.requires_state
            ],
            "max_occurrences": [
                {"tool": mo.tool, "count": mo.count, "scope": mo.scope}
                for mo in wf.max_occurrences
            ],
        }

    return CompiledPolicy(policy=policy, cbac=cbac, difc=difc, rules=rules, workflows=compiled_workflows)
