"""Threat intel guard — Python port of src/policy/threat-intel-guard.ts."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SIGNATURES_PATH = REPO_ROOT / "config" / "threat-intel-signatures.json"

_cached_patterns: list[re.Pattern[str]] | None = None
_cached_at: float = 0.0
_CACHE_TTL_SEC = 60.0


def _compile_pattern(source: str) -> re.Pattern[str] | None:
    trimmed = source.strip()
    if not trimmed:
        return None
    try:
        return re.compile(trimmed, re.I)
    except re.error:
        escaped = re.escape(trimmed)
        return re.compile(escaped, re.I)


def _load_baseline_patterns() -> list[re.Pattern[str]]:
    if not SIGNATURES_PATH.is_file():
        return []
    try:
        data = json.loads(SIGNATURES_PATH.read_text(encoding="utf-8"))
        patterns: list[re.Pattern[str]] = []
        for raw in data.get("patterns") or []:
            compiled = _compile_pattern(str(raw))
            if compiled:
                patterns.append(compiled)
        return patterns
    except (OSError, json.JSONDecodeError):
        return []


def _resolve_threat_state_path() -> Path:
    env_path = os.environ.get("MASTYF_AI_THREAT_STATE_PATH")
    if env_path:
        return Path(env_path)
    home = os.environ.get("MASTYF_AI_HOME")
    if home:
        return Path(home) / ".threat-state.json"
    return Path.home() / ".mastyf-ai" / ".threat-state.json"


def _load_dynamic_patterns() -> list[re.Pattern[str]]:
    path = _resolve_threat_state_path()
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        entries = data.get("entries") or data.get("catalog") or []
        patterns: list[re.Pattern[str]] = []
        for entry in entries:
            signature = entry.get("signature")
            if signature:
                compiled = _compile_pattern(str(signature))
                if compiled:
                    patterns.append(compiled)
            desc = entry.get("description")
            severity = entry.get("severity")
            if desc and severity in ("CRITICAL", "HIGH"):
                snippet = str(desc)[:120].strip()
                if len(snippet) >= 24:
                    compiled = _compile_pattern(snippet)
                    if compiled:
                        patterns.append(compiled)
        return patterns
    except (OSError, json.JSONDecodeError):
        return []


def _get_patterns() -> list[re.Pattern[str]]:
    global _cached_patterns, _cached_at
    if os.environ.get("MASTYF_AI_DISABLE_THREAT_INTEL_GUARD") == "true":
        return []
    import time

    now = time.time()
    if _cached_patterns is not None and now - _cached_at < _CACHE_TTL_SEC:
        return _cached_patterns
    _cached_patterns = _load_baseline_patterns() + _load_dynamic_patterns()
    _cached_at = now
    return _cached_patterns


def reset_threat_intel_guard_cache() -> None:
    global _cached_patterns, _cached_at
    _cached_patterns = None
    _cached_at = 0.0


def evaluate_threat_intel_guard(arguments: dict | None) -> tuple[str, str] | None:
    from .arg_walker import walk_string_leaves

    patterns = _get_patterns()
    if not patterns:
        return None
    blob = "\n".join(leaf.value for leaf in walk_string_leaves(arguments or {}))
    if not blob:
        return None
    for pattern in patterns:
        if pattern.search(blob):
            return ("threat-intel", "Threat intel signature matched in tool arguments")
    return None
