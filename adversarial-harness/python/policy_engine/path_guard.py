"""Path guard — mirrors path-guard.ts sensitive path patterns."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

PATH_ARG_FIELDS = frozenset(
    {"path", "file", "filepath", "file_path", "directory", "dir"},
)

SENSITIVE_PATH_PATTERNS = [
    re.compile(r"^/$"),
    re.compile(r"^/etc(?:/|$)"),
    re.compile(r"^/root(?:/|$)"),
    re.compile(r"^/proc(?:/|$)"),
    re.compile(r"/proc/self/environ"),
    re.compile(r"link_to.*(?:aws|credential|secret|\.env)", re.I),
    re.compile(r"&ref\s+/(?:etc|proc|root|\.)"),
    re.compile(r"yaml\s*anchor", re.I),
    re.compile(r"^/sys(?:/|$)"),
    re.compile(r"/\.ssh(?:/|$)"),
    re.compile(r"/\.aws/credentials$"),
    re.compile(r"/\.env(?:\.|$)"),
    re.compile(r"(?:^|/)id_rsa(?:\.|$)"),
    re.compile(r"(?:^|/)authorized_keys$"),
    re.compile(r"/\.kube(?:/|$)"),
    re.compile(r"/var/run/docker\.sock$"),
    re.compile(r"/var/run/secrets/kubernetes\.io/"),
    re.compile(r"(?:^|/)terraform\.tfstate(?:\.|$)"),
    re.compile(r"(?:^|/)passwd$"),
]

PATH_LIKE = re.compile(
    r"(?:^|[\s\"'`])(?:~\/|\/|\.\/|\.\.|\\|\.kube|\.ssh|\.env|id_rsa)",
    re.I,
)


@dataclass
class PathGuardResult:
    block: bool
    reason: str = ""


def extract_path_argument_values(args: dict[str, object] | None) -> list[str]:
    if not args:
        return []
    out: list[str] = []
    for key, val in args.items():
        if key.lower() in PATH_ARG_FIELDS and isinstance(val, str):
            out.append(val)
    return out


def evaluate_path_guard(paths: Iterable[str]) -> PathGuardResult:
    for p in paths:
        norm = p.strip()
        for pat in SENSITIVE_PATH_PATTERNS:
            if pat.search(norm):
                return PathGuardResult(
                    block=True,
                    reason=f"Blocked sensitive path: {norm[:80]}",
                )
    return PathGuardResult(block=False)
