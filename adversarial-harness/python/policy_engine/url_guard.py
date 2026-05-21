"""URL guard — mirrors url-guard.ts (SSRF / localhost / private IP)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable
from urllib.parse import urlparse

from .arg_walker import walk_string_leaves

URL_ARG_FIELDS = frozenset(
    {"url", "href", "target", "webhook", "callback", "link", "message", "query", "body", "content", "text", "prompt"}
)
BLOCKED_SCHEMES = frozenset({"file", "javascript", "data", "vbscript", "about"})
DOCUMENTATION_HOST_ALLOWLIST = frozenset(
    {
        "example.com",
        "www.example.com",
        "docs.example.com",
    }
)

LOCALHOST_NAMES = frozenset(
    {
        "localhost",
        "localhost.localdomain",
        "metadata",
        "metadata.google.internal",
        "metadata.google",
        "kubernetes.default.svc",
    }
)
PRIVATE_IPV4 = [
    re.compile(r"^127\."),
    re.compile(r"^10\."),
    re.compile(r"^192\.168\."),
    re.compile(r"^172\.(?:1[6-9]|2\d|3[01])\."),
    re.compile(r"^0\."),
    re.compile(r"^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\."),
    re.compile(r"^169\.254\."),
]
METADATA_IPV4 = re.compile(r"^169\.254\.")
HTTP_URL_IN_TEXT = re.compile(r"https?://[^\s\"'<>]+", re.I)


def _is_private_ipv4(host: str) -> bool:
    return any(p.search(host) for p in PRIVATE_IPV4)


def _decimal_ip_to_dotted(n: int) -> str:
    return ".".join(str((n >> shift) & 0xFF) for shift in (24, 16, 8, 0))


def _normalize_dotted_host(host: str) -> str:
    if not re.fullmatch(r"[\d.x]+", host, re.I) or "." not in host:
        return host
    parts = host.split(".")
    if len(parts) != 4:
        return host
    normalized: list[int] = []
    for part in parts:
        if re.fullmatch(r"0x[0-9a-f]+", part, re.I):
            normalized.append(int(part, 16) & 0xFF)
        elif re.fullmatch(r"0[0-7]+", part) and len(part) > 1:
            normalized.append(int(part, 8) & 0xFF)
        else:
            try:
                n = int(part, 10)
            except ValueError:
                return host
            if n < 0 or n > 255:
                return host
            normalized.append(n)
    return ".".join(str(n) for n in normalized)


def _is_decimal_ip_host(host: str) -> bool:
    if not re.fullmatch(r"\d{1,10}", host):
        return False
    n = int(host)
    return 0 <= n <= 0xFFFFFFFF and host == str(n)


def is_dangerous_url(raw: str) -> tuple[bool, str]:
    trimmed = raw.strip()
    if not trimmed:
        return False, ""
    if re.match(r"^(?:file|javascript|data|vbscript):", trimmed, re.I):
        return True, f"Blocked URL scheme: {trimmed[:32]}"

    try:
        parsed = urlparse(trimmed if re.match(r"^[a-z][a-z0-9+.-]*:", trimmed, re.I) else f"http://{trimmed}")
    except Exception:
        return False, ""

    scheme = (parsed.scheme or "").lower()
    if scheme in BLOCKED_SCHEMES:
        return True, f"Blocked URL scheme ({scheme})"

    host = (parsed.hostname or "").lower()
    if not host:
        return False, ""

    if re.fullmatch(r"0x[0-9a-f]+", host, re.I):
        try:
            n = int(host, 16)
            if 0 <= n <= 0xFFFFFFFF:
                host = _decimal_ip_to_dotted(n)
        except ValueError:
            pass
    elif re.fullmatch(r"[\d.x]+", host, re.I):
        host = _normalize_dotted_host(host)

    if host in LOCALHOST_NAMES or host.endswith(".localhost"):
        return True, f"Blocked localhost/metadata host: {host}"

    if _is_decimal_ip_host(host):
        dotted = _decimal_ip_to_dotted(int(host))
        if _is_private_ipv4(dotted) or METADATA_IPV4.search(dotted):
            return True, f"Blocked decimal IP (maps to {dotted})"

    if re.fullmatch(r"[\d.]+", host):
        if _is_private_ipv4(host) or METADATA_IPV4.search(host):
            return True, f"Blocked private/metadata IP: {host}"

    if ":" in host and (host == "::1" or host.startswith("fe80:") or host.startswith(("fc", "fd"))):
        return True, f"Blocked local/private IPv6: {host}"

    if METADATA_IPV4.search(host):
        return True, f"Blocked metadata IP: {host}"

    if host in DOCUMENTATION_HOST_ALLOWLIST:
        return False, ""

    return False, ""


def extract_http_urls_from_leaves(obj: object) -> list[str]:
    urls: list[str] = []
    for leaf in walk_string_leaves(obj):
        key = leaf.path.split(".")[-1].lower()
        if key in URL_ARG_FIELDS:
            urls.append(leaf.value)
        urls.extend(m.group(0) for m in HTTP_URL_IN_TEXT.finditer(leaf.value))
    return urls


@dataclass
class UrlGuardResult:
    block: bool
    reason: str = ""


def evaluate_url_guard(urls: Iterable[str]) -> UrlGuardResult:
    expanded: list[str] = []
    for raw in urls:
        expanded.append(raw)
        expanded.extend(m.group(0) for m in HTTP_URL_IN_TEXT.finditer(raw))
    for raw in expanded:
        block, reason = is_dangerous_url(raw)
        if block:
            return UrlGuardResult(block=True, reason=reason)
    return UrlGuardResult(block=False)
