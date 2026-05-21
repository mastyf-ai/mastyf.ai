#!/usr/bin/env python3
"""
Enterprise adversarial harness — matrix + corpus + custom suites with trustworthy reporting.
"""

from __future__ import annotations

import json
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from policy_engine import PolicyEngine
from policy_engine.policy_engine import context_from_dict
from policy_engine.session_flow_guard import reset_session_flow_history
from policy_engine.types import PolicyDecision

HARNESS_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = HARNESS_ROOT.parent
CORPUS_DIR = REPO_ROOT / "corpus"
MATRIX_DIR = HARNESS_ROOT / "fixtures" / "matrix"
CUSTOM_DIR = HARNESS_ROOT / "fixtures" / "custom-attacks"
REPORT_DIR = HARNESS_ROOT / "reports"


@dataclass
class TestCase:
    id: str
    category: str
    expected: str
    source: str
    rel_path: str
    raw: dict[str, Any]


def discover_json_fixtures(directory: Path, source: str, *, rel_base: Path | None = None) -> list[TestCase]:
    if not directory.is_dir():
        return []
    base = rel_base or directory
    cases: list[TestCase] = []
    for path in sorted(directory.rglob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        rel = str(path.relative_to(base))
        case_id = str(data.get("id") or f"{source}:{rel}")
        category = str(data.get("category", source))
        expected = str(data.get("expected", "block"))
        cases.append(TestCase(case_id, category, expected, source, rel, data))
    return cases


def load_all_cases() -> tuple[list[TestCase], dict[str, Any]]:
    meta: dict[str, Any] = {"corpusDir": str(CORPUS_DIR), "corpusExists": CORPUS_DIR.is_dir()}
    cases: list[TestCase] = []

    corpus_attacks = len(list((CORPUS_DIR / "attacks").rglob("*.json"))) if (CORPUS_DIR / "attacks").is_dir() else 0
    corpus_benign = len(list((CORPUS_DIR / "benign").rglob("*.json"))) if (CORPUS_DIR / "benign").is_dir() else 0
    meta["corpusAttacksOnDisk"] = corpus_attacks
    meta["corpusBenignOnDisk"] = corpus_benign

    cases.extend(discover_json_fixtures(CORPUS_DIR, "corpus", rel_base=CORPUS_DIR))
    cases.extend(discover_json_fixtures(MATRIX_DIR, "matrix", rel_base=MATRIX_DIR))
    cases.extend(discover_json_fixtures(CUSTOM_DIR, "custom", rel_base=CUSTOM_DIR))

    meta["loaded"] = {
        "corpus": sum(1 for c in cases if c.source == "corpus"),
        "matrix": sum(1 for c in cases if c.source == "matrix"),
        "custom": sum(1 for c in cases if c.source == "custom"),
    }
    return cases, meta


def _isolated_engine_key(case: TestCase) -> str:
    if case.category == "rate-limit-evasion":
        return "isolated:rate-limit-evasion"
    if case.category == "token-evasion":
        return "isolated:token-evasion"
    if case.category == "rbac-evasion":
        return "isolated:rbac-evasion"
    return f"isolated:{case.id}"


def evaluate_case(case: TestCase, engines: dict[str, PolicyEngine]) -> PolicyDecision:
    reset_session_flow_history()
    data = case.raw
    if data.get("policyMode") == "isolated" and data.get("isolatedPolicy"):
        key = _isolated_engine_key(case)
        if key not in engines:
            engines[key] = PolicyEngine.from_policy_dict(data["isolatedPolicy"])
        engine = engines[key]
        ctx = context_from_dict(data.get("context") or {})
        return engine.evaluate(ctx, sync_mode="yaml_only")
    ctx = context_from_dict(
        {
            "toolName": data.get("toolName"),
            "arguments": data.get("arguments"),
            **(data.get("context") or {}),
        },
    )
    if "toolName" not in (data.get("context") or {}) and data.get("toolName"):
        ctx.tool_name = str(data["toolName"])
    if data.get("arguments"):
        ctx.arguments = dict(data["arguments"])
    return engines["default"].evaluate(ctx)


def run() -> dict[str, Any]:
    start = time.perf_counter()
    cases, load_meta = load_all_cases()
    engines: dict[str, PolicyEngine] = {"default": PolicyEngine.from_default_policy()}

    by_category: dict[str, dict[str, Any]] = {}
    failures: list[dict[str, Any]] = []
    duplicate_ids: dict[str, int] = {}
    passed = 0
    failed = 0

    corpus_tp = corpus_fp = corpus_tn = corpus_fn = 0
    matrix_passed = matrix_failed = 0

    for case in cases:
        duplicate_ids[case.id] = duplicate_ids.get(case.id, 0) + 1
        try:
            decision = evaluate_case(case, engines)
        except Exception as exc:
            decision = PolicyDecision("pass", "error", str(exc))
            failures.append({
                "id": case.id,
                "category": case.category,
                "reason": f"evaluation error: {exc}",
            })
            failed += 1
            continue

        blocked = decision.action in ("block", "flag")
        expect_block = case.expected == "block"
        ok = blocked == expect_block

        cat = by_category.setdefault(
            case.category,
            {"category": case.category, "total": 0, "passed": 0, "failed": 0, "failures": []},
        )
        cat["total"] += 1
        if ok:
            passed += 1
            cat["passed"] += 1
        else:
            failed += 1
            cat["failed"] += 1
            entry = {
                "id": case.id,
                "source": case.source,
                "rel": case.rel_path,
                "expected": case.expected,
                "actual": decision.action,
                "rule": decision.rule,
                "reason": decision.reason[:200],
            }
            failures.append(entry)
            cat["failures"].append(entry)

        if case.source == "corpus":
            if expect_block and blocked:
                corpus_tp += 1
            elif expect_block and not blocked:
                corpus_fn += 1
            elif not expect_block and not blocked:
                corpus_tn += 1
            else:
                corpus_fp += 1
        elif case.source == "matrix":
            if ok:
                matrix_passed += 1
            else:
                matrix_failed += 1

    dupes = {k: v for k, v in duplicate_ids.items() if v > 1}
    elapsed = time.perf_counter() - start
    matrix_total = sum(1 for c in cases if c.source == "matrix")
    corpus_total = sum(1 for c in cases if c.source == "corpus")

    custom_total = sum(1 for c in cases if c.source == "custom")
    custom_bypassed = sum(
        1
        for f in failures
        if f.get("source") == "custom" and f.get("expected") == "block"
    )
    custom_blocked = custom_total - custom_bypassed

    report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "elapsedSeconds": round(elapsed, 2),
        "pythonPolicyEngine": {
            "passed": passed,
            "failed": failed,
            "total": len(cases),
            "passRate": passed / len(cases) if cases else 0,
            "summary": f"{passed}/{len(cases)} passed → {(100 * passed / len(cases)) if cases else 0:.1f}%",
        },
        "corpus": {
            "attacks": load_meta.get("corpusAttacksOnDisk", 0),
            "benign": load_meta.get("corpusBenignOnDisk", 0),
            "loaded": corpus_total,
            "tp": corpus_tp,
            "fp": corpus_fp,
            "tn": corpus_tn,
            "fn": corpus_fn,
            "passed": corpus_fn == 0 and corpus_fp == 0 and corpus_total > 0,
        },
        "evasion": {
            "total": custom_total,
            "blocked": custom_blocked,
            "bypassed": custom_bypassed,
        },
        "matrix": {
            "total": matrix_total,
            "passed": matrix_passed,
            "failed": matrix_failed,
        },
        "loadMeta": load_meta,
        "byCategory": sorted(by_category.values(), key=lambda x: x["category"]),
        "duplicateIds": dupes,
        "failures": failures,
        "passed": corpus_fn == 0 and corpus_fp == 0 and matrix_failed == 0 and len(dupes) == 0,
    }
    return report


def main() -> int:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = run()
    out = REPORT_DIR / "comprehensive-eval.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")

    pe = report["pythonPolicyEngine"]
    print(json.dumps({
        "passed": report["passed"],
        "python": pe["summary"],
        "corpus": report["corpus"],
        "evasion": report["evasion"],
        "matrix": report["matrix"],
        "elapsed": report["elapsedSeconds"],
    }, indent=2))

    if report["failures"]:
        print("\n".join(
            f"FAIL {f['id']} expected={f['expected']} actual={f['actual']} rule={f.get('rule')}"
            for f in report["failures"][:25]
        ))
    if report["duplicateIds"]:
        print("DUPLICATE IDS:", report["duplicateIds"])

    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
