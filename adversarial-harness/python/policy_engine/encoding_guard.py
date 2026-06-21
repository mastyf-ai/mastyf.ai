"""Encoding evasion detection — mirrors encoding-guard.ts."""

from __future__ import annotations

import base64
import os
import re
from typing import Optional

from .arg_walker import walk_string_leaves
from .normalizer import deobfuscate_recursive, ZERO_WIDTH_RE
from .types import CallContext, PolicyDecision

BASE64_BLOB_RE = re.compile(r"(?:^|[^A-Za-z0-9+/])([A-Za-z0-9+/]{20,}={0,2})(?:[^A-Za-z0-9+/]|$)")
RAW_HEX_BLOB_RE = re.compile(r"\b([0-9a-fA-F]{16,})\b")
PERCENT_ENCODED_RUN_RE = re.compile(r"(?:%[0-9a-fA-F]{2}){4,}", re.I)
SUSPICIOUS_DECODED_RE = re.compile(
    r"\b(?:ignore|disregard|bypass|jailbreak|delete|drop|exec|eval|curl|wget|"
    r"passwd|pretend|forget|exfiltrate|malicious|unrestricted|benchmark|"
    r"rm\s+-rf|union\s+select|sleep\s*\(|/etc/passwd|bash|/bin/sh|"
    r"select\s+\*|\bselect\b|/dev/tcp|delete\s+account|drop\s+table)\b",
    re.I,
)
SHELL_FRAGMENT_RE = re.compile(
    r"\b(?:rm\s+-rf|union\s+select|sleep\s*\(|benchmark\s*\(|/etc/passwd|/bin/sh|"
    r"select\s+\*|/dev/tcp|delete\s+account|drop\s+table)\b",
    re.I,
)
OVERRIDE_ATTACK_RE = re.compile(
    r"\boverride\b.{0,80}\b(?:all|previous|prior|safety|instruction|rules|system|filter|restriction|guidance)\b",
    re.I,
)


def _encoding_transform_applied(original: str, decoded: str) -> bool:
    if not decoded or decoded == original:
        return False
    norm = lambda s: re.sub(r"\s+", " ", s.replace("\r\n", "\n")).strip()
    return norm(original) != norm(decoded)


def _decoded_suspicious(original: str, decoded: str) -> bool:
    if not _encoding_transform_applied(original, decoded):
        return False
    if (
        SUSPICIOUS_DECODED_RE.search(decoded)
        or OVERRIDE_ATTACK_RE.search(decoded)
        or SHELL_FRAGMENT_RE.search(decoded)
    ):
        return True
    try:
        from .prompt_injection import scan_tool_call_arguments

        hits = scan_tool_call_arguments({"payload": decoded}, critical_only=True)
        return len(hits) > 0
    except Exception:
        return False


def is_encoding_guard_enabled() -> bool:
    return os.environ.get("MASTYF_AI_ENCODING_GUARD") != "false"


def _try_decode_base64(b64: str) -> Optional[str]:
    if len(b64) < 12 or len(b64) % 4 == 1:
        return None
    try:
        decoded = base64.b64decode(b64 + "==="[: (4 - len(b64) % 4) % 4], validate=False).decode("utf-8")
        if len(decoded) < 4:
            return None
        return decoded
    except Exception:
        return None


def _try_decode_raw_hex(hex_str: str) -> Optional[str]:
    if len(hex_str) < 16 or len(hex_str) % 2 != 0:
        return None
    try:
        decoded = bytes.fromhex(hex_str).decode("utf-8")
        if len(decoded) < 4 or not all(0x20 <= ord(c) <= 0x7E for c in decoded):
            return None
        return decoded
    except Exception:
        return None


def scan_encoding_evasion(blob: str) -> tuple[bool, str]:
    if not blob.strip():
        return False, ""
    deobfuscated = deobfuscate_recursive(blob)
    stripped_invisible = ZERO_WIDTH_RE.sub("", blob)
    if _decoded_suspicious(blob, deobfuscated):
        return True, "multi-layer encoding reveals blocked content after decode"
    if stripped_invisible != blob and _decoded_suspicious(blob, stripped_invisible):
        return True, "zero-width stripped content is suspicious after decode"
    if PERCENT_ENCODED_RUN_RE.search(blob) and _decoded_suspicious(blob, deobfuscated):
        return True, "percent-encoded payload decodes to suspicious content"
    for match in BASE64_BLOB_RE.finditer(blob):
        decoded = _try_decode_base64(match.group(1))
        if decoded and _decoded_suspicious(match.group(1), decoded):
            return True, "base64 blob decodes to suspicious instruction text"
    for match in RAW_HEX_BLOB_RE.finditer(blob):
        decoded = _try_decode_raw_hex(match.group(1))
        if decoded and _decoded_suspicious(match.group(1), decoded):
            return True, "raw hex blob decodes to suspicious instruction text"
    trimmed = blob.strip()
    if re.fullmatch(r"[A-Za-z0-9+/]+={0,2}", trimmed):
        whole = _try_decode_base64(trimmed)
        if whole and _decoded_suspicious(trimmed, whole):
            return True, "whole-string base64 decodes to suspicious content"
    return False, ""


def evaluate_encoding_guard(ctx: CallContext) -> Optional[PolicyDecision]:
    if not is_encoding_guard_enabled():
        return None
    blob = "\n".join(leaf.value for leaf in walk_string_leaves(ctx.arguments or {}))
    if not blob.strip():
        return None
    matched, reason = scan_encoding_evasion(blob)
    if not matched:
        return None
    return PolicyDecision("block", "encoding-evasion-guard", reason)
