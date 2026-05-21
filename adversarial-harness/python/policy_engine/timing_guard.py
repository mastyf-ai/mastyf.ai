"""Timing side-channel probe detection — mirrors timing-guard.ts."""

from __future__ import annotations

import hashlib
import os
import re
import time
from typing import Optional

from .arg_walker import walk_string_leaves
from .normalizer import deobfuscate_recursive
from .types import CallContext, PolicyDecision

TIMING_PROBE_PATTERNS: list[re.Pattern[str]] = [
    re.compile(
        r"\b(?:sleep|benchmark|pg_sleep|pg_sleep_for|pg_sleep_until|waitfor\s+delay|"
        r"dbms_lock\.sleep|dbms_pipe\.receive_message|dbms_session\.sleep)\s*\(",
        re.I,
    ),
    re.compile(r"\bif\s*\(\s*(?:ascii|ord|substring|substr|mid|left|right)\s*\(", re.I),
    re.compile(
        r"\b(?:case\s+when|elt\s*\(|decode\s*\()\s+.*\b(?:sleep|benchmark|waitfor|pg_sleep)",
        re.I,
    ),
    re.compile(r"\b(?:timing|time[- ]?based)\s+(?:attack|oracle|injection|blind)", re.I),
    re.compile(r"\b(?:measure|detect|compare)\s+(?:response\s+)?time\s+(?:of|for|between)", re.I),
    re.compile(r"\b(?:valid|invalid)\s+username\b.*\b(?:timing|delay|sleep|benchmark)", re.I),
    re.compile(r"\busername\s+exists\b.*\b(?:time|delay|benchmark|sleep)", re.I),
    re.compile(r"\b(?:SLEEP|BENCHMARK)\s*\(\s*\d+", re.I),
    re.compile(r"\bWAITFOR\s+DELAY\s+'", re.I),
    re.compile(r"\b(?:select|union)\b.+\bwhere\b.+\b(?:sleep|benchmark|waitfor)", re.I),
    re.compile(r"\b'\s*or\s*'1'\s*=\s*'1\b.+\b(?:sleep|benchmark|waitfor|delay)", re.I),
    re.compile(r"\b(?:and|or)\s+\d+\s*=\s*\d+\s*--", re.I),
    re.compile(r"\bldap[_-]?search\b.+\b(?:delay|sleep|time)", re.I),
    re.compile(r"\$where\b.+\b(?:sleep|this\.constructor)", re.I),
    re.compile(r"\b(?:load_file|into\s+outfile)\b.+\b(?:sleep|benchmark)", re.I),
    re.compile(r"\bhex\s*\(\s*(?:substring|mid)\s*\(", re.I),
    re.compile(r"\b(?:response|elapsed)\s+time\s*(?:>|<|>=|<=)\s*\d+", re.I),
    re.compile(r"\buser[_-]?enumeration\b.*\b(?:timing|oracle)", re.I),
    re.compile(r"\b(?:binary|blind)\s+search\b.*\b(?:char|password|secret)", re.I),
]

USERNAME_ORACLE_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\bwhere\b\s+(?:user|username|email|login)\s*=\s*['\"][^'\"]{1,64}['\"]", re.I),
    re.compile(r"\b(?:admin|root|administrator)\b.*\b(?:and|or)\b.*\b(?:sleep|benchmark|waitfor)", re.I),
    re.compile(r"\b(?:'|%27)\s*(?:or|and)\s*(?:'|%27)?\d+['\"]?\s*=\s*['\"]?\d+", re.I),
    re.compile(r"\b(?:exists|in\s*\(\s*select)\b.+\b(?:users|accounts|credentials)", re.I),
]

PROBE_WINDOW_S = 60.0
ENUM_WINDOW_S = 120.0
MAX_TIMING_PROBES = int(os.environ.get("MCP_GUARDIAN_MAX_TIMING_PROBES_PER_MIN", "8"))
MAX_ENUM_PROBES = int(os.environ.get("MCP_GUARDIAN_MAX_ENUM_PROBES_PER_SESSION", "20"))

_probe_counters: dict[str, tuple[int, float]] = {}
_enum_counters: dict[str, tuple[int, float]] = {}


def is_timing_guard_enabled() -> bool:
    return os.environ.get("GUARDIAN_TIMING_GUARD") != "false"


def reset_timing_probe_counters() -> None:
    _probe_counters.clear()
    _enum_counters.clear()


def _stable_fingerprint(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def scan_timing_probe_patterns(blob: str) -> tuple[bool, list[str]]:
    rule_ids: list[str] = []
    if not blob.strip():
        return False, rule_ids
    for i, pat in enumerate(TIMING_PROBE_PATTERNS):
        if pat.search(blob):
            rule_ids.append(f"timing-probe-{i}")
    for i, pat in enumerate(USERNAME_ORACLE_PATTERNS):
        if pat.search(blob):
            rule_ids.append(f"username-oracle-{i}")
    return len(rule_ids) > 0, rule_ids


def enumeration_fingerprint(blob: str) -> str:
    normalized = blob.lower()
    normalized = re.sub(r"['\"][^'\"]{1,80}['\"]", "<q>", normalized)
    normalized = re.sub(r"\b(?:admin|root|administrator|user\d*|test\d*|guest)\b", "<u>", normalized)
    normalized = re.sub(r"\d+", "N", normalized)
    return _stable_fingerprint(normalized)[:16]


def _increment_counter(
    store: dict[str, tuple[int, float]],
    key: str,
    window_s: float,
) -> int:
    now = time.time()
    count, reset_at = store.get(key, (0, now + window_s))
    if now > reset_at:
        count, reset_at = 1, now + window_s
    else:
        count += 1
    store[key] = (count, reset_at)
    return count


def _build_timing_blob(ctx: CallContext) -> str:
    return "\n".join(
        deobfuscate_recursive(leaf.value) for leaf in walk_string_leaves(ctx.arguments or {})
    )


def _is_enumeration_probe_candidate(blob: str, tool_name: str) -> bool:
    tool_lower = tool_name.lower()
    if re.search(
        r"(?:login|log-?in|auth|signin|sign-in|verify|register|password|credential|account)",
        tool_lower,
        re.I,
    ):
        return True
    if re.search(r"\b(?:user(?:name)?|email|login|account|password)\b", blob, re.I):
        return True
    return any(p.search(blob) for p in USERNAME_ORACLE_PATTERNS)


def _probe_session_key(ctx: CallContext) -> str:
    tenant = ctx.tenant_id or os.environ.get("GUARDIAN_TENANT_ID") or "default"
    sub = "anon"
    if ctx.agent_identity:
        sub = ctx.agent_identity.sub or ctx.agent_identity.client_id or "anon"
    return f"{tenant}:{ctx.server_name}:{sub}"


def evaluate_timing_guard(ctx: CallContext) -> Optional[PolicyDecision]:
    if not is_timing_guard_enabled():
        return None

    blob = _build_timing_blob(ctx)
    if not blob.strip():
        return None

    session_key = _probe_session_key(ctx)
    matched, rule_ids = scan_timing_probe_patterns(blob)

    if matched:
        probe_count = _increment_counter(_probe_counters, session_key, PROBE_WINDOW_S)
        if probe_count > MAX_TIMING_PROBES:
            return PolicyDecision(
                "block",
                "timing-probe-rate-limit",
                f"Timing oracle probe rate exceeded ({probe_count}/{MAX_TIMING_PROBES} per minute)",
            )
        ids = ", ".join(rule_ids[:3])
        return PolicyDecision(
            "block",
            "timing-side-channel-guard",
            f"Timing side-channel probe detected ({ids})",
        )

    if _is_enumeration_probe_candidate(blob, ctx.tool_name):
        enum_key = f"{session_key}:{ctx.tool_name}:{enumeration_fingerprint(blob)}"
        enum_count = _increment_counter(_enum_counters, enum_key, ENUM_WINDOW_S)
        if enum_count > MAX_ENUM_PROBES:
            return PolicyDecision(
                "block",
                "timing-enumeration-guard",
                f"Timing enumeration oracle: {enum_count} similar probes for tool '{ctx.tool_name}'",
            )

    return None
