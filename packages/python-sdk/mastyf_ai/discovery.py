"""Where the checks come from, in order:

1. MASTYF_CHECK_URL (+ MASTYF_CHECK_TOKEN): a check service you run (e.g. the Docker image).
2. A free check service already running on this machine (127.0.0.1:4100, its token file readable).
   It must first prove it knows the token (it signs a random nonce); anything else listening on
   that port never receives the token.
3. The Shield app (paid) on this machine: not available until Shield's next release defines how a
   client finds it and knows the answer really came from Shield.
4. The free check program, started by this library.
"""

from __future__ import annotations

import hashlib
import hmac
import os
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
    return Found(client, str(health.get("tier", "free")))


def running_local(env: Mapping[str, str], home: Path) -> Found | None:
    try:
        token = token_path(env, home).read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if len(token) < 32:
        return None
    client = CheckClient(LOCAL_URL, token, timeout=10.0)
    nonce = secrets.token_hex(16)
    health = client.health(nonce=nonce)
    expected = hmac.new(token.encode(), nonce.encode(), hashlib.sha256).hexdigest()
    if not health or health.get("tier") != "free" or not hmac.compare_digest(str(health.get("proof", "")), expected):
        client.close()
        return None
    return Found(client, "free")


def _shield_client() -> Found | None:
    """The paid Shield app's check API. Shield's next release defines the contract; until then nothing."""
    return None
