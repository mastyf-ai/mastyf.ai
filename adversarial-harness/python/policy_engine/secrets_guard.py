"""Minimal secret detection for harness parity (PEM, JWT, AWS keys)."""

from __future__ import annotations

import re

PEM_KEY = re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----")
JWT_TOKEN = re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")
AWS_ACCESS = re.compile(r"(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])")
GITHUB_PAT = re.compile(r"ghp_[A-Za-z0-9]{20,}")
STRIPE_KEY = re.compile(r"sk_live_[0-9a-zA-Z]{24,}")


def scan_secrets_in_blob(blob: str) -> list[str]:
    hits: list[str] = []
    if PEM_KEY.search(blob):
        hits.append("generic-private-key")
    if JWT_TOKEN.search(blob):
        hits.append("jwt-bearer-token")
    if AWS_ACCESS.search(blob):
        hits.append("aws-access-key")
    if GITHUB_PAT.search(blob):
        hits.append("github-pat-classic")
    if STRIPE_KEY.search(blob):
        hits.append("stripe-secret-key")
    return hits


def scan_secrets_in_response(blob: str, context: str) -> list[str]:
    return scan_secrets_in_blob(blob)
