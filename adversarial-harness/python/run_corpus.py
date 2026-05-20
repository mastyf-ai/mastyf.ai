#!/usr/bin/env python3
"""Corpus-only eval (151 attacks + 55 benign) for parity with TS corpus/run-eval.ts."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from policy_engine import PolicyEngine
from policy_engine.policy_engine import context_from_dict

HARNESS_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = HARNESS_ROOT.parent
CORPUS_DIR = REPO_ROOT / "corpus"
REPORT_DIR = HARNESS_ROOT / "reports"


def load_corpus() -> list[tuple[str, dict]]:
    out: list[tuple[str, dict]] = []
    for path in sorted(CORPUS_DIR.rglob("*.json")):
        rel = str(path.relative_to(CORPUS_DIR))
        if rel.startswith("."):
            continue
        out.append((rel, json.loads(path.read_text(encoding="utf-8"))))
    return out


def main() -> int:
    engine = PolicyEngine.from_default_policy()
    entries = load_corpus()
    tp = fp = tn = fn = 0
    failures: list[str] = []

    for rel, entry in entries:
        ctx = context_from_dict(
            {
                "serverName": "corpus-eval",
                "toolName": entry.get("toolName", "search"),
                "arguments": entry.get("arguments") or {},
                "requestTokens": 50,
            },
        )
        decision = engine.evaluate(ctx)
        blocked = decision.action in ("block", "flag")
        expected = entry.get("expected", "block")

        if expected == "block":
            if blocked:
                tp += 1
            else:
                fn += 1
                failures.append(f"MISSED [{rel}] → {decision.action}")
        else:
            if not blocked:
                tn += 1
            else:
                fp += 1
                failures.append(f"FP [{rel}] rule={decision.rule}")

    attacks = tp + fn
    benign = tn + fp
    report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "semanticDisabled": True,
        "attacksBlocked": tp,
        "attacksTotal": attacks,
        "benignPassed": tn,
        "benignTotal": benign,
        "falsePositives": fp,
        "missed": fn,
        "passed": fn == 0 and fp == 0,
        "failures": failures[:50],
    }

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    (REPORT_DIR / "python-corpus-eval.json").write_text(
        json.dumps(report, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(report, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
