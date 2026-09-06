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

    return PolicyDocument(
        id=_string(root.get("id"), "id"),
        version=_string(root.get("version"), "version"),
        description=str(root.get("description", "")),
        capabilities=caps,
        information_flow=InformationFlowRule(taints=taints),
        rules=rules,
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
    return CompiledPolicy(policy=policy, cbac=cbac, difc=difc, rules=rules)
