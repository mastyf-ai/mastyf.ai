"""Where the checks come from, in order:

1. MASTYF_CHECK_URL (+ MASTYF_CHECK_TOKEN): a check service you run (e.g. the Docker image).
2. The Shield app (paid) on this machine: its address and token are in Shield's owner-only file
   (%APPDATA%\\Mastyf\\shield\\check.json, or ~/.mastyf/shield/check.json). Used only on 127.0.0.1,
   and only after it proves it knows the token and says it is Shield.
3. A free check service already running on this machine (127.0.0.1:4100, its token file readable).
   It must first prove it knows the token (it signs a random nonce); anything else listening on
   that port never receives the token.
4. The free check program, started by this library.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

from .client import CheckClient

LOCAL_URL = "http://127.0.0.1:4100"


def token_path(env: Mapping[str, str], home: Path) -> Path:
    """The free service's token file: ~/.mastyf/check/token (Windows: %APPDATA%\\Mastyf\\check\\token)."""
    if os.name == "nt":
        base = Path(env.get("APPDATA") or home / "AppData" / "Roaming")
        return base / "Mastyf" / "check" / "token"
    return home / ".mastyf" / "check" / "token"


@dataclass
class Found:
    client: CheckClient
    tier: str


def configured(env: Mapping[str, str]) -> Found | None:
    url = env.get("MASTYF_CHECK_URL")
    if not url:
        return None
    client = CheckClient(url, env.get("MASTYF_CHECK_TOKEN", ""))
    health = client.health() or {}
    client.limit_body(health.get("maxBodyBytes"))
    return Found(client, str(health.get("tier", "free")))


def _proven(url: str, token: str, tier: str) -> Found | None:
    """A check service on this machine that proves it knows `token` and reports `tier`; else None."""
    client = CheckClient(url, token, timeout=10.0)
    nonce = secrets.token_hex(16)
    health = client.health(nonce=nonce)
    expected = hmac.new(token.encode(), nonce.encode(), hashlib.sha256).hexdigest()
    if not health or health.get("tier") != tier or not hmac.compare_digest(str(health.get("proof", "")), expected):
        client.close()
        return None
    client.limit_body(health.get("maxBodyBytes"))
    return Found(client, tier)


def running_local(env: Mapping[str, str], home: Path) -> Found | None:
    try:
        token = token_path(env, home).read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if len(token) < 32:
        return None
    return _proven(LOCAL_URL, token, "free")


def shield_file_path(env: Mapping[str, str], home: Path) -> Path:
    """Where the Shield app writes its check API's address and token."""
    if os.name == "nt":
        base = Path(env.get("APPDATA") or home / "AppData" / "Roaming")
        return base / "Mastyf" / "shield" / "check.json"
    return home / ".mastyf" / "shield" / "check.json"


_THIS_MACHINE = re.compile(r"http://127\.0\.0\.1:\d{1,5}")


def shield_client(env: Mapping[str, str], home: Path) -> Found | None:
    """The paid Shield app's check API, when Shield is running on this machine."""
    try:
        found = json.loads(shield_file_path(env, home).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(found, dict):
        return None
    url, token = found.get("url"), found.get("token")
    # Only this machine: the token must never go anywhere a changed file could point it.
    if not isinstance(url, str) or not _THIS_MACHINE.fullmatch(url):
        return None
    if not isinstance(token, str) or len(token) < 32:
        return None
    return _proven(url, token, "shield")
