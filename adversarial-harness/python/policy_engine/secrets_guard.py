"""Secret detection — parity with src/scanners/secret-scanner.ts."""

from __future__ import annotations

import json
import math
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

EXPORTED_RULES = Path(__file__).resolve().parents[2] / "exported" / "secret_rules_meta.json"
_MAX_SCAN_CHARS = 32_768

_COMPILED_FULL: Optional[list[dict[str, Any]]] = None
_COMPILED_FAST: Optional[list[dict[str, Any]]] = None

# Hot-path rules for policy evaluation (subset of production critical/high rules).
_FAST_RULE_IDS = frozenset(
    {
        "aws-access-key",
        "aws-secret-key",
        "aws-session-token",
        "github-pat-classic",
        "github-pat-fine-grained",
        "github-pat",
        "github-fine-grained-pat",
        "stripe-secret-key",
        "stripe-restricted-key",
        "generic-private-key",
        "jwt-bearer-token",
        "jwt",
        "openai-api-key",
        "anthropic-api-key",
        "slack-bot-token",
        "slack-token",
        "npm-access-token",
        "postgres-connection-string",
        "generic-api-key",
        "password-in-url",
        "private-key",
        "password_assign",
        "generic-password",
    }
)


def _compile_secret_regex(pattern: str, flags: str) -> re.Pattern[str]:
    regex = pattern
    flag_str = flags or ""
    if "(?i:" in regex:
        regex = regex.replace("(?i:", "(?:")
        if "i" not in flag_str:
            flag_str += "i"
    if "(?s:" in regex:
        regex = regex.replace("(?s:", "(?:")
        if "s" not in flag_str:
            flag_str += "s"
    re_flags = 0
    if "i" in flag_str:
        re_flags |= re.I
    if "s" in flag_str:
        re_flags |= re.S
    if "m" in flag_str:
        re_flags |= re.M
    return re.compile(regex, re_flags)


def _shannon_entropy(s: str) -> float:
    if not s:
        return 0.0
    freq: dict[str, int] = {}
    for ch in s:
        freq[ch] = freq.get(ch, 0) + 1
    n = len(s)
    return -sum((c / n) * math.log2(c / n) for c in freq.values())


def _entropy_subject(match: re.Match[str]) -> str:
    full = match.group(0)
    if match.lastindex and match.lastindex >= 1:
        captured = match.group(1)
        if captured and len(captured) >= 8 and len(captured) >= len(full) * 0.5:
            return captured
    return full


def _compile_rule_list(raw: list[dict[str, Any]], *, fast_only: bool) -> list[dict[str, Any]]:
    compiled: list[dict[str, Any]] = []
    for r in raw:
        rid = r["id"]
        if fast_only and rid not in _FAST_RULE_IDS:
            sev = str(r.get("severity", "")).upper()
            if sev not in ("CRITICAL", "HIGH"):
                continue
        try:
            compiled.append(
                {
                    "id": rid,
                    "regex": _compile_secret_regex(r["regex"], r.get("flags", "")),
                    "entropy": r.get("entropy"),
                    "exclusions": [
                        re.compile(e, re.I) for e in (r.get("falsePositiveExclusions") or [])
                    ],
                }
            )
        except re.error:
            continue
    return compiled


def _load_rules(*, full: bool = False) -> list[dict[str, Any]]:
    global _COMPILED_FULL, _COMPILED_FAST
    if full:
        if _COMPILED_FULL is None:
            if not EXPORTED_RULES.is_file():
                raise FileNotFoundError(f"Run export-harness-rules.ts first: {EXPORTED_RULES}")
            raw = json.loads(EXPORTED_RULES.read_text(encoding="utf-8"))
            _COMPILED_FULL = _compile_rule_list(raw, fast_only=False)
        return _COMPILED_FULL
    if _COMPILED_FAST is None:
        if not EXPORTED_RULES.is_file():
            raise FileNotFoundError(f"Run export-harness-rules.ts first: {EXPORTED_RULES}")
        raw = json.loads(EXPORTED_RULES.read_text(encoding="utf-8"))
        _COMPILED_FAST = _compile_rule_list(raw, fast_only=True)
    return _COMPILED_FAST


def _is_postmark_token_context(target: str, scan_context: str, match_index: int | None = None) -> bool:
    haystack = f"{scan_context}\n{target}".lower()
    if re.search(r"postmark|server[_-]?token|x-postmark", haystack, re.I):
        return True
    if match_index is not None:
        window_start = max(0, match_index - 80)
        window = target[window_start : match_index + 80].lower()
        if re.search(r"postmark|pm[_-]?token|server[_-]?token", window):
            return True
    return False


def _scan_with_rules(scan_text: str, rules: list[dict[str, Any]], max_hits: int = 8, *, context: str = "harness") -> list[str]:
    hits: list[str] = []
    seen: set[str] = set()
    for rule in rules:
        if len(hits) >= max_hits:
            break
        if not rule["regex"].search(scan_text):
            continue
        for m in rule["regex"].finditer(scan_text):
            subject = _entropy_subject(m)
            if rule.get("entropy") is not None and _shannon_entropy(subject) < rule["entropy"]:
                continue
            if rule["id"] == "postmark-api-token" and not _is_postmark_token_context(
                scan_text, context, m.start()
            ):
                continue
            excluded = any(ex.search(scan_text) for ex in rule.get("exclusions") or [])
            if excluded:
                continue
            rid = rule["id"]
            if rid not in seen:
                seen.add(rid)
                hits.append(rid)
            break
    return hits


def scan_secrets_in_blob(blob: str, context: str = "harness", *, full: bool = False) -> list[str]:
    """Policy hot path uses fast critical/high rules; set full=True for harness battery."""
    if not blob or len(blob) < 8:
        return []
    if len(blob) > _MAX_SCAN_CHARS:
        half = _MAX_SCAN_CHARS // 2
        scan_text = blob[:half] + blob[-half:]
    else:
        scan_text = blob
    rules = _load_rules(full=full)
    return _scan_with_rules(scan_text, rules, context=context)


def scan_secrets_in_response(blob: str, context: str) -> list[str]:
    return scan_secrets_in_blob(blob, context)


@lru_cache(maxsize=1)
def get_full_rule_count() -> int:
    return len(_load_rules(full=True))
