"""
Mastyf Gateway Commercial Entitlement Verification Subsystem
Verifies asymmetric Ed25519 signatures, enforces local offline grace periods,
supports trusted key rotation, and guarantees zero PII in local gateway records.
"""

import json
import base64
from pathlib import Path
from datetime import datetime, timezone
from enum import Enum
from typing import Optional, Tuple, Dict, Any

from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.exceptions import InvalidSignature

class EntitlementStatus(str, Enum):
    ACTIVE = "ACTIVE"
    GRACE_PERIOD = "GRACE_PERIOD"
    EXPIRED = "EXPIRED"
    TAMPERED = "TAMPERED"
    UNTRUSTED_KEY = "UNTRUSTED_KEY"
    UNLICENSED = "UNLICENSED"

# Trusted Ed25519 public keys for key rotation (current + previous trusted keys)
# The private signing key is NEVER distributed to customer machines.
TRUSTED_KEYRING: Dict[str, str] = {
    "mastyf-prod-2026-01": "32oq11SmArntsjpxVw0kihCFaQd7RVMEqouSR0C5LlY=",
    "mastyf-prod-2025-04": "JgC/Y8108j60V3u2R8hV9E9UjZ+o4g0tT7VnK2y6E1c=",
}

def canonicalize_entitlement(payload: Dict[str, Any]) -> bytes:
    """
    Produces deterministic canonical JSON serialization sorted by key,
    excluding the signature field itself.
    """
    fields = {k: v for k, v in payload.items() if k != "signature"}
    # Canonical JSON string with sorted keys and no unnecessary whitespace
    sorted_obj = {k: fields[k] for k in sorted(fields.keys())}
    return json.dumps(sorted_obj, separators=(',', ':')).encode("utf-8")

def parse_iso_datetime(dt_str: str) -> datetime:
    """Parses ISO-8601 string into UTC datetime."""
    # Replace Z with +00:00 for compatibility
    clean_str = dt_str.replace("Z", "+00:00")
    dt = datetime.fromisoformat(clean_str)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt

def verify_entitlement_payload(
    payload: Dict[str, Any],
    keyring: Optional[Dict[str, str]] = None,
    current_time: Optional[datetime] = None,
) -> Tuple[EntitlementStatus, str]:
    """
    Verifies an Ed25519 signed entitlement token against the trusted keyring.
    Enforces expiration dates and the 7-day offline grace period.
    """
    active_keyring = keyring or TRUSTED_KEYRING
    now = current_time or datetime.now(timezone.utc)

    # 1. Required schema fields
    required_fields = [
        "schema",
        "product",
        "license_id",
        "instance_id",
        "activation_id",
        "model_repo",
        "model_revision",
        "key_id",
        "expires_at",
        "grace_until",
        "signature",
    ]
    for rf in required_fields:
        if rf not in payload:
            return EntitlementStatus.TAMPERED, f"Missing required entitlement field: '{rf}'"

    # 2. Key Rotation / Trusted Keyring Check
    key_id = payload.get("key_id", "")
    if key_id not in active_keyring:
        return EntitlementStatus.UNTRUSTED_KEY, f"Unknown or untrusted signing key_id: '{key_id}'"

    pub_b64 = active_keyring[key_id]

    # 3. Cryptographic Signature Verification
    try:
        pub_bytes = base64.b64decode(pub_b64)
        sig_bytes = base64.b64decode(payload["signature"])
        canonical_bytes = canonicalize_entitlement(payload)

        public_key = ed25519.Ed25519PublicKey.from_public_bytes(pub_bytes)
        public_key.verify(sig_bytes, canonical_bytes)
    except (InvalidSignature, ValueError) as e:
        return EntitlementStatus.TAMPERED, f"Cryptographic signature verification failed: {str(e)}"
    except Exception as e:
        return EntitlementStatus.TAMPERED, f"Malformed signature or public key: {str(e)}"

    # 4. Temporal Validity & Offline Grace Period Checks
    try:
        expires_at = parse_iso_datetime(payload["expires_at"])
        grace_until = parse_iso_datetime(payload["grace_until"])
    except Exception as e:
        return EntitlementStatus.TAMPERED, f"Invalid date format in entitlement: {str(e)}"

    if now <= expires_at:
        return EntitlementStatus.ACTIVE, f"License active until {expires_at.strftime('%Y-%m-%d %H:%M UTC')}"

    if expires_at < now <= grace_until:
        return (
            EntitlementStatus.GRACE_PERIOD,
            f"License entered offline grace period (Expires: {grace_until.strftime('%Y-%m-%d %H:%M UTC')})",
        )

    return (
        EntitlementStatus.EXPIRED,
        f"License expired on {expires_at.strftime('%Y-%m-%d')} and grace period elapsed on {grace_until.strftime('%Y-%m-%d')}",
    )

def get_entitlement_path(home_dir: Path) -> Path:
    return home_dir / "entitlement.json"

def load_local_entitlement(home_dir: Path) -> Tuple[EntitlementStatus, Optional[Dict[str, Any]], str]:
    """
    Loads and cryptographically validates the locally cached entitlement file.
    Returns (Status, Payload, Description).
    """
    ent_file = get_entitlement_path(home_dir)
    if not ent_file.exists():
        return EntitlementStatus.UNLICENSED, None, "No commercial entitlement found (Run 'mastyf activate')"

    try:
        content = json.loads(ent_file.read_text())
    except Exception:
        return EntitlementStatus.TAMPERED, None, "Corrupted local entitlement file"

    status, detail = verify_entitlement_payload(content)
    return status, content, detail

def save_local_entitlement(home_dir: Path, token_data: Dict[str, Any]) -> None:
    """Atomically persists the signed entitlement token to ~/.mastyf/entitlement.json."""
    home_dir.mkdir(parents=True, exist_ok=True)
    ent_file = get_entitlement_path(home_dir)
    temp_file = home_dir / f"entitlement.tmp.{datetime.now().timestamp()}"

    temp_file.write_text(json.dumps(token_data, indent=2))
    temp_file.replace(ent_file)
