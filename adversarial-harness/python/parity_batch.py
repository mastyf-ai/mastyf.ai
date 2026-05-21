#!/usr/bin/env python3
"""Batch parity — keyed by string id (never integer index)."""

from __future__ import annotations

import json
import sys
from typing import Any

from policy_engine import PolicyEngine
from policy_engine.policy_engine import context_from_dict
from policy_engine.session_flow_store import reset_session_flow_history
from policy_engine.timing_guard import reset_timing_probe_counters
from policy_engine.types import PolicyDecision


def _isolated_key(entry: dict[str, Any]) -> str:
    cat = entry.get("category", "")
    if cat == "rate-limit-evasion":
        return "isolated:rate-limit-evasion"
    if cat == "token-evasion":
        return "isolated:token-evasion"
    if cat == "rbac-evasion":
        return "isolated:rbac-evasion"
    return f"isolated:{entry['id']}"


def evaluate_entry(entry: dict[str, Any], engines: dict[str, PolicyEngine]) -> dict[str, Any]:
    case_id = str(entry["id"])
    if entry.get("policyMode") == "isolated" and entry.get("isolatedPolicy"):
        key = _isolated_key(entry)
        if key not in engines:
            engines[key] = PolicyEngine.from_policy_dict(entry["isolatedPolicy"])
        engine = engines[key]
        ctx = context_from_dict(entry.get("context") or {})
        dec = engine.evaluate(ctx, sync_mode="yaml_only")
    else:
        ctx = context_from_dict({
            "toolName": entry.get("toolName"),
            "arguments": entry.get("arguments") or {},
            **(entry.get("context") or {}),
        })
        reset_session_flow_history()
        reset_timing_probe_counters()
        dec = engines["default"].evaluate(ctx)
    return {
        "id": case_id,
        "blocked": dec.action in ("block", "flag"),
        "action": dec.action,
        "rule": dec.rule,
        "reason": dec.reason,
    }


def main() -> None:
    items = json.load(sys.stdin)
    engines: dict[str, PolicyEngine] = {"default": PolicyEngine.from_default_policy()}
    by_id: dict[str, Any] = {}
    for entry in items:
        eid = str(entry.get("id") or entry.get("rel", ""))
        entry["id"] = eid
        by_id[eid] = evaluate_entry(entry, engines)
    json.dump({"byId": by_id}, sys.stdout)


if __name__ == "__main__":
    main()
