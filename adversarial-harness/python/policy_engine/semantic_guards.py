"""Semantic guards — mirrors semantic-guards.ts."""

from __future__ import annotations

import os
import re
from typing import Any, Optional

from .arg_walker import walk_string_leaves
from .injection_preprocess import preprocess_for_injection_match
from .normalizer import deobfuscate_recursive, detect_shell_in_base64_blobs
from .path_guard import PATH_ARG_FIELDS, PATH_LIKE, evaluate_path_guard
from .types import CallContext, PolicyDecision
from .url_guard import evaluate_url_guard, extract_http_urls_from_leaves

SQL_SENSITIVE = (
    "accounts|customers|users|credentials|secrets|payments|transactions|admin_users|passwords"
)
SQL_EXFIL_PATTERNS = [
    re.compile(rf"\bselect\b.+\bfrom\b.+\b(?:{SQL_SENSITIVE})\b", re.I),
    re.compile(rf"\bselect\s+\*\s+from\b.+\b(?:{SQL_SENSITIVE})\b", re.I),
    re.compile(r"\b(?:drop|truncate)\s+(?:table|database)\b", re.I),
    re.compile(r"\bdelete\s+from\b", re.I),
    re.compile(r"\bunion\b.+\bselect\b", re.I),
    re.compile(r"/\*+\s*union\b", re.I),
    re.compile(r"\bor\s+['\"]?1['\"]?\s*=\s*['\"]?1['\"]?\b", re.I),
    re.compile(r"\bor\s+1\s*=\s*1\b", re.I),
    re.compile(r"\b'\s*or\s*'1'\s*=\s*'1", re.I),
    re.compile(r"\badmin'\s*--", re.I),
    re.compile(r"\bcase\s+when\b.+\b(?:password|secret|token|credential)", re.I),
    re.compile(r"\bload_file\s*\(", re.I),
    re.compile(r"\bsleep\s*\(", re.I),
    re.compile(r"\bbenchmark\s*\(", re.I),
    re.compile(r"\binto\s+outfile\b", re.I),
    re.compile(r'"\$where"\s*:', re.I),
    re.compile(r'"\$gt"\s*:', re.I),
    re.compile(r'"\$regex"\s*:', re.I),
    re.compile(r'"\$ne"\s*:', re.I),
    re.compile(r"\$where\b", re.I),
    re.compile(r"\$gt\b", re.I),
    re.compile(r"\$regex\b", re.I),
    re.compile(r"\$ne\b", re.I),
    re.compile(r"__schema\b", re.I),
    re.compile(r"\bintrospection\b", re.I),
    re.compile(r"admin\)\s*\(&", re.I),
    re.compile(r"\*\)\s*\(\s*uid\s*=", re.I),
    re.compile(r"\*\)\s*\(", re.I),
    re.compile(r"\|\s*\(\s*\|", re.I),
    re.compile(r"\)\s*\(\s*\|", re.I),
    re.compile(r"\)\s*\)\s*\(", re.I),
]

BASE64_SHELL_PATTERNS = [
    re.compile(r"\bbase64\s+(?:-d|--decode)\b.+\|\s*(?:sh|bash|zsh)\b", re.I),
    re.compile(r"\|\s*base64\s+(?:-d|--decode)\b.+\|\s*(?:sh|bash|zsh)\b", re.I),
    re.compile(
        r"\becho\s+['\"]?[A-Za-z0-9+/]{12,}={0,2}['\"]?\s*\|\s*base64\s+(?:-d|--decode)\b",
        re.I,
    ),
]

POWERSHELL_PATTERNS = [
    re.compile(r"\bpowershell(?:\.exe)?\b", re.I),
    re.compile(r"\bpwsh\b", re.I),
    re.compile(r"-enc(?:odedcommand)?\b", re.I),
    re.compile(r"\biex\b", re.I),
]

SSTI_PATTERNS = [re.compile(r"\{\{"), re.compile(r"\$\{"), re.compile(r"<%"), re.compile(r"#\{")]

MULTILINE_INJECTION = [
    re.compile(
        r"(?:ignore|disregard).{0,120}?(?:instructions|rules|guidelines|directives)",
        re.I | re.M | re.S,
    ),
    re.compile(r"(?:system|assistant)[\s\S]{0,40}:\s*you\s+are", re.I | re.M | re.S),
    re.compile(r"<\|(?:endoftext|im_start|im_end)\|>", re.I),
]

RATE_IDENTITY_EVASION = [
    re.compile(r"x-forwarded-for\s*[:=]\s*[\d.,\s]+", re.I),
    re.compile(r"x-real-ip\s*[:=]\s*[\d.]+", re.I),
    re.compile(r"(?:client[_-]?id|sub|tenant[_-]?id)\s*[:=]\s*['\"]?(?:admin|root|system|spoof)", re.I),
    re.compile(r"(?:reveal|show|print|disclose).{0,40}(?:rate[- ]?limit|ratelimit).{0,30}key", re.I),
    re.compile(r"\b(?:unlimited|no[- ]?limit|ignore|disable|bypass).{0,40}(?:rate[- ]?limit|throttle|quota)", re.I),
    re.compile(r"\b(?:flood|spam|hammer|burst).{0,30}(?:tool[- ]?calls?|requests?|api)", re.I),
]

TOKEN_BUDGET_ABUSE = [
    re.compile(r"\b(?:ignore|bypass|exceed|disable|raise).{0,40}(?:token[- ]?budget|max[- ]?tokens?|context[- ]?limit)", re.I),
    re.compile(r"\b(?:fill|exhaust|maximize).{0,30}(?:context|token|window)", re.I),
]

LANGUAGE_GADGET = [
    re.compile(r"\b(?:pickle\.loads?|cPickle|__reduce__|PYCC)\b", re.I),
    re.compile(r"\bObjectInputStream\b|\breadObject\s*\(\s*\)", re.I),
    re.compile(r"\bjava\.io\.(?:Serializable|ObjectInputStream)\b", re.I),
    re.compile(r"\b(?:node-serialize|unserialize\s*\(|__wakeup|__destruct)\b", re.I),
    re.compile(r"\bMarshal\.load\b|\byaml\.unsafe_load\b", re.I),
]

LOG_INJECTION = [
    re.compile(r"\r\n[^\n]{0,120}\r\n"),
    re.compile(r"\n(?:INFO|WARN|ERROR|DEBUG|AUDIT|TRACE)\s*:\s*(?:user|admin|override|success)", re.I),
    re.compile(r"\b(?:INFO|WARN|ERROR|DEBUG|AUDIT|TRACE)\s*:\s*(?:user|admin|override=success)", re.I),
    re.compile(r"\x1b\[[0-9;]*[A-Za-z]"),
    re.compile(r"(?:forge|spoof|inject|poison).{0,40}(?:audit|log|syslog|trail)", re.I),
    re.compile(r"\]\s*\(\s*#\s*(?:forge|fake|spoof)", re.I),
    re.compile(r"%0[aAdD]", re.I),
]

REPO_FIELDS = frozenset({"repo", "repository", "owner"})


def _extract_path_candidates(args: dict[str, Any]) -> list[str]:
    out: list[str] = []
    if args:
        for key, val in args.items():
            if key.lower() in PATH_ARG_FIELDS and isinstance(val, str):
                out.append(val)
    out.extend(leaf.value for leaf in walk_string_leaves(args) if PATH_LIKE.search(leaf.value))
    return list(dict.fromkeys(out))


def evaluate_semantic_guards(ctx: CallContext) -> Optional[PolicyDecision]:
    args = ctx.arguments or {}

    path_check = evaluate_path_guard(_extract_path_candidates(args))
    if path_check.block:
        return PolicyDecision("block", "semantic-path-guard", path_check.reason)

    urls = list(dict.fromkeys(extract_http_urls_from_leaves(args)))
    url_check = evaluate_url_guard(urls, ctx.tool_name)
    if url_check.block:
        return PolicyDecision("block", "semantic-url-guard", url_check.reason)

    for leaf in walk_string_leaves(args):
        decoded = deobfuscate_recursive(leaf.value)
        for pat in SQL_EXFIL_PATTERNS:
            if pat.search(decoded):
                return PolicyDecision(
                    "block",
                    "semantic-sql-guard",
                    f"SQL/NoSQL/LDAP pattern blocked in tool '{ctx.tool_name}'",
                )

    blob = deobfuscate_recursive("\n".join(leaf.value for leaf in walk_string_leaves(args)))
    for pat in BASE64_SHELL_PATTERNS:
        if pat.search(blob):
            return PolicyDecision(
                "block",
                "semantic-shell-guard",
                "Base64-decode piped to shell detected in arguments",
            )
    if detect_shell_in_base64_blobs(blob):
        return PolicyDecision(
            "block",
            "semantic-shell-guard",
            "Base64 blob decodes to shell/downloader command in arguments",
        )

    for pat in POWERSHELL_PATTERNS:
        if pat.search(blob):
            return PolicyDecision(
                "block",
                "semantic-powershell-guard",
                "PowerShell execution pattern detected in arguments",
            )

    for pat in SSTI_PATTERNS:
        if pat.search(blob):
            return PolicyDecision(
                "block",
                "semantic-ssti-guard",
                "Server-side template injection pattern detected in arguments",
            )

    for pat in LANGUAGE_GADGET:
        if pat.search(blob):
            return PolicyDecision(
                "block",
                "semantic-language-gadget",
                "Language-specific deserialization gadget pattern in arguments",
            )

    raw_log = "\n".join(leaf.value for leaf in walk_string_leaves(args))
    for pat in LOG_INJECTION:
        if pat.search(raw_log):
            return PolicyDecision(
                "block",
                "semantic-log-injection",
                "Log or audit trail injection pattern in arguments",
            )

    inj_blob = preprocess_for_injection_match(
        "\n".join(deobfuscate_recursive(leaf.value) for leaf in walk_string_leaves(args))
    )
    if inj_blob.strip():
        for pat in MULTILINE_INJECTION:
            if pat.search(inj_blob):
                return PolicyDecision(
                    "block",
                    "semantic-prompt-injection",
                    "Multi-line prompt injection pattern in arguments",
                )
        for pat in RATE_IDENTITY_EVASION:
            if pat.search(inj_blob):
                return PolicyDecision(
                    "block",
                    "semantic-rate-limit-evasion",
                    "Rate-limit or identity key evasion pattern in arguments",
                )
        for pat in TOKEN_BUDGET_ABUSE:
            if pat.search(inj_blob):
                return PolicyDecision(
                    "block",
                    "semantic-token-budget-abuse",
                    "Token budget bypass or exhaustion pattern in arguments",
                )
    for leaf in walk_string_leaves(args):
        key = leaf.path.split(".")[-1].lower()
        if key in REPO_FIELDS and re.search(r"(?:attacker|honeypot|evil|malware|exfil)", leaf.value, re.I):
            return PolicyDecision(
                "block",
                "semantic-github-guard",
                f"Suspicious GitHub repo target: {leaf.value}",
            )

    allowed = os.environ.get("GUARDIAN_GITHUB_ALLOWED_REPOS", "").strip()
    if allowed:
        allowed_list = [s.strip() for s in allowed.split(",") if s.strip()]
        for leaf in walk_string_leaves(args):
            key = leaf.path.split(".")[-1].lower()
            if key in REPO_FIELDS and not any(
                leaf.value == a or leaf.value.startswith(f"{a}/") for a in allowed_list
            ):
                return PolicyDecision(
                    "block",
                    "semantic-github-guard",
                    f"GitHub repo '{leaf.value}' not in allowlist",
                )

    return None
