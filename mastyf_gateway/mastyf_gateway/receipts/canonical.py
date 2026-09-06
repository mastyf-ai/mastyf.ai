"""
Mastyf Canonical Serialization and Hashing Utilities.

Provides deterministic, cross-platform JSON serialization and SHA-256 digests:
- Keys sorted lexicographically
- Compact separators (",", ":")
- Non-escaped Unicode (ensure_ascii=False)
- Explicit UTF-8 byte encoding
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Dict


def canonical_json(obj: Any) -> bytes:
    """Serializes a Python object into canonical, deterministic UTF-8 JSON bytes."""
    return json.dumps(
        obj,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")


def canonical_hash(obj: Any) -> str:
    """Computes a hex-encoded SHA-256 digest over canonical JSON bytes."""
    return hashlib.sha256(canonical_json(obj)).hexdigest()


def hash_arguments(args: Dict[str, Any]) -> str:
    """Computes the deterministic canonical hash for tool arguments."""
    if not isinstance(args, dict):
        args = {}
    return canonical_hash(args)


def hash_policy(policy_obj: Any) -> str:
    """
    Computes a deterministic hash over the compiled or runtime policy representation,
    ensuring that formatting, comments, or whitespace changes do not alter the identity.
    """
    if hasattr(policy_obj, "as_runtime_config"):
        data = policy_obj.as_runtime_config()
    elif hasattr(policy_obj, "model_dump"):
        data = policy_obj.model_dump()
    elif hasattr(policy_obj, "dict"):
        data = policy_obj.dict()
    elif isinstance(policy_obj, dict):
        data = policy_obj
    else:
        data = str(policy_obj)
    return canonical_hash(data)
