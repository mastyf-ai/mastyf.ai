"""Prompt injection detector — mirrors scanToolCallArguments()."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

from .arg_walker import walk_string_leaves
from .injection_preprocess import injection_match_variants
from .normalizer import deobfuscate_recursive

EXPORTED_RULES = (
    Path(__file__).resolve().parents[2] / "exported" / "injection_rules.json"
)

DEFAULT_TRUSTED_EXFIL_DOMAINS = frozenset(
    {
        "github.com",
        "raw.githubusercontent.com",
        "api.github.com",
        "gitlab.com",
        "bitbucket.org",
    }
)


@dataclass
class InjectionFinding:
    severity: str
    pattern_id: str
    description: str
    match_preview: str


def _load_rules() -> list[tuple[str, str, str, re.Pattern[str]]]:
    data = json.loads(EXPORTED_RULES.read_text(encoding="utf-8"))
    out: list[tuple[str, str, str, re.Pattern[str]]] = []
    for r in data:
        out.append(
            (r["id"], r["severity"], r["description"], re.compile(r["regex"], re.I | re.M | re.S)),
        )
    return out


_COMPILED: Optional[list[tuple[str, str, str, re.Pattern[str]]]] = None


def get_patterns() -> list[tuple[str, str, str, re.Pattern[str]]]:
    global _COMPILED
    if _COMPILED is None:
        _COMPILED = _load_rules()
    return _COMPILED


def _is_benign_trusted_url(url: str) -> bool:
    try:
        host = urlparse(url).hostname or ""
        host = host.lower()
        for t in DEFAULT_TRUSTED_EXFIL_DOMAINS:
            if host == t or host.endswith(f".{t}"):
                return True
    except Exception:
        pass
    return False


def match_injection_patterns(
    decoded: str,
    seen: set[str],
    critical_only: bool = False,
) -> list[InjectionFinding]:
    findings: list[InjectionFinding] = []
    for pid, severity, desc, regex in get_patterns():
        if critical_only and severity != "critical":
            continue
        m = None
        variants = injection_match_variants(
            decoded,
            include_rot13=pid in ("rot13-obfuscation", "ignore-instructions", "leetspeak-injection"),
        )
        for variant in variants:
            m = regex.search(variant)
            if m:
                break
        if not m:
            continue
        if pid == "exfiltration-url":
            url_m = re.search(r"https?://[^\s\"'<>]+", m.group(0), re.I)
            if url_m and _is_benign_trusted_url(url_m.group(0)):
                continue
        dedup = f"{pid}:{m.start()}"
        if dedup in seen:
            continue
        seen.add(dedup)
        start = max(0, m.start() - 30)
        end = min(len(decoded), m.end() + 20)
        preview = decoded[start:end].replace("\n", " ")
        preview = re.sub(r"\s+", " ", preview)
        findings.append(
            InjectionFinding(
                severity=severity,
                pattern_id=pid,
                description=desc,
                match_preview=f"...{preview[:100]}...",
            ),
        )
    return findings


def scan_tool_call_arguments(
    args: Optional[dict[str, Any]],
    critical_only: bool = False,
) -> list[InjectionFinding]:
    if not args:
        return []
    findings: list[InjectionFinding] = []
    seen: set[str] = set()
    for leaf in walk_string_leaves(args):
        if not leaf.value.strip():
            continue
        decoded = deobfuscate_recursive(leaf.value)
        for f in match_injection_patterns(decoded, seen, critical_only):
            dedup = f"{f.pattern_id}:{f.match_preview}"
            if dedup in seen:
                continue
            seen.add(dedup)
            findings.append(f)
    return findings
