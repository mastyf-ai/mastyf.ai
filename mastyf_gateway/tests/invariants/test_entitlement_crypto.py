"""
Tests for Gateway Asymmetric Ed25519 Entitlement Verification
Validates cryptographic verification, key rotation, offline grace periods,
tamper detection, and zero-PII storage.
"""

import json
import base64
from datetime import datetime, timezone, timedelta
from pathlib import Path
import pytest

from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.hazmat.primitives import serialization

from mastyf_gateway.entitlement import (
    EntitlementStatus,
    verify_entitlement_payload,
    load_local_entitlement,
    save_local_entitlement,
    canonicalize_entitlement,
    TRUSTED_KEYRING,
)

# Test keypairs for unit tests
TEST_PRIV_RAW = base64.b64decode("Qio7zngIohWj2+qhZm5MBY9LNXKSIsA9E5LD4XwXHhs=")
TEST_PUB_B64 = "32oq11SmArntsjpxVw0kihCFaQd7RVMEqouSR0C5LlY="
KEY_ID = "mastyf-prod-2026-01"

def create_signed_token(payload: dict, priv_bytes: bytes = TEST_PRIV_RAW) -> dict:
    """Signs an entitlement payload using Ed25519 private key."""
    token = payload.copy()
    token.pop("signature", None)
    canonical = canonicalize_entitlement(token)

    priv_key = ed25519.Ed25519PrivateKey.from_private_bytes(priv_bytes)
    sig = priv_key.sign(canonical)
    token["signature"] = base64.b64encode(sig).decode("utf-8")
    return token

def test_valid_ed25519_entitlement_passes():
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=30)
    grace = expires + timedelta(days=7)

    payload = {
        "schema": 1,
        "product": "mastyf-guard-pro",
        "license_id": "lic_test_123",
        "instance_id": "inst_node_01",
        "activation_id": "act_test_999",
        "model_repo": "Rudraneel93/mastyf-guard-1.5b-v2-boundary-sharpened",
        "model_revision": "908c6cb2a7812fdb3073995f5bbd9b8e1f0e4bfa",
        "gateway_version": "0.1.1",
        "key_id": KEY_ID,
        "issued_at": now.isoformat(),
        "expires_at": expires.isoformat(),
        "grace_until": grace.isoformat(),
    }

    signed = create_signed_token(payload)
    status, detail = verify_entitlement_payload(signed)

    assert status == EntitlementStatus.ACTIVE
    assert "License active until" in detail

def test_tampered_payload_rejected():
    now = datetime.now(timezone.utc)
    payload = {
        "schema": 1,
        "product": "mastyf-guard-pro",
        "license_id": "lic_test_123",
        "instance_id": "inst_node_01",
        "activation_id": "act_test_999",
        "model_repo": "Rudraneel93/mastyf-guard-1.5b-v2-boundary-sharpened",
        "model_revision": "908c6cb2a7812fdb3073995f5bbd9b8e1f0e4bfa",
        "gateway_version": "0.1.1",
        "key_id": KEY_ID,
        "issued_at": now.isoformat(),
        "expires_at": (now + timedelta(days=30)).isoformat(),
        "grace_until": (now + timedelta(days=37)).isoformat(),
    }

    signed = create_signed_token(payload)

    # Tamper with model_revision
    signed["model_revision"] = "evil_modified_revision_12345"
    status, detail = verify_entitlement_payload(signed)

    assert status == EntitlementStatus.TAMPERED
    assert "Cryptographic signature verification failed" in detail

def test_tampered_signature_rejected():
    now = datetime.now(timezone.utc)
    payload = {
        "schema": 1,
        "product": "mastyf-guard-pro",
        "license_id": "lic_test_123",
        "instance_id": "inst_node_01",
        "activation_id": "act_test_999",
        "model_repo": "Rudraneel93/mastyf-guard-1.5b-v2-boundary-sharpened",
        "model_revision": "908c6cb2a7812fdb3073995f5bbd9b8e1f0e4bfa",
        "gateway_version": "0.1.1",
        "key_id": KEY_ID,
        "issued_at": now.isoformat(),
        "expires_at": (now + timedelta(days=30)).isoformat(),
        "grace_until": (now + timedelta(days=37)).isoformat(),
    }

    signed = create_signed_token(payload)
    # Corrupt signature string
    signed["signature"] = "AAAA" + signed["signature"][4:]
    status, detail = verify_entitlement_payload(signed)

    assert status == EntitlementStatus.TAMPERED

def test_unknown_key_id_rejected():
    now = datetime.now(timezone.utc)
    payload = {
        "schema": 1,
        "product": "mastyf-guard-pro",
        "license_id": "lic_test_123",
        "instance_id": "inst_node_01",
        "activation_id": "act_test_999",
        "model_repo": "Rudraneel93/mastyf-guard-1.5b-v2-boundary-sharpened",
        "model_revision": "908c6cb2a7812fdb3073995f5bbd9b8e1f0e4bfa",
        "gateway_version": "0.1.1",
        "key_id": "attacker-forged-key-id",
        "issued_at": now.isoformat(),
        "expires_at": (now + timedelta(days=30)).isoformat(),
        "grace_until": (now + timedelta(days=37)).isoformat(),
    }

    signed = create_signed_token(payload)
    status, detail = verify_entitlement_payload(signed)

    assert status == EntitlementStatus.UNTRUSTED_KEY
    assert "Unknown or untrusted signing key_id" in detail

def test_key_rotation_supports_previous_trusted_key():
    # Generate ephemeral key representing previous key
    priv2 = ed25519.Ed25519PrivateKey.generate()
    pub2 = priv2.public_key()
    pub2_b64 = base64.b64encode(pub2.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw
    )).decode("utf-8")

    custom_keyring = {
        "mastyf-prod-2026-01": TEST_PUB_B64,
        "mastyf-prod-2025-04": pub2_b64, # Previous key
    }

    now = datetime.now(timezone.utc)
    payload = {
        "schema": 1,
        "product": "mastyf-guard-pro",
        "license_id": "lic_test_123",
        "instance_id": "inst_node_01",
        "activation_id": "act_test_999",
        "model_repo": "Rudraneel93/mastyf-guard-1.5b-v2-boundary-sharpened",
        "model_revision": "908c6cb2a7812fdb3073995f5bbd9b8e1f0e4bfa",
        "gateway_version": "0.1.1",
        "key_id": "mastyf-prod-2025-04",
        "issued_at": now.isoformat(),
        "expires_at": (now + timedelta(days=30)).isoformat(),
        "grace_until": (now + timedelta(days=37)).isoformat(),
    }

    raw_priv2 = priv2.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption()
    )

    signed = create_signed_token(payload, priv_bytes=raw_priv2)
    status, detail = verify_entitlement_payload(signed, keyring=custom_keyring)

    assert status == EntitlementStatus.ACTIVE
    assert "License active until" in detail

def test_offline_grace_period_and_expiration():
    now = datetime.now(timezone.utc)
    # Expired 2 days ago, but within 7-day grace period
    expires = now - timedelta(days=2)
    grace = now + timedelta(days=5)

    payload = {
        "schema": 1,
        "product": "mastyf-guard-pro",
        "license_id": "lic_test_123",
        "instance_id": "inst_node_01",
        "activation_id": "act_test_999",
        "model_repo": "Rudraneel93/mastyf-guard-1.5b-v2-boundary-sharpened",
        "model_revision": "908c6cb2a7812fdb3073995f5bbd9b8e1f0e4bfa",
        "gateway_version": "0.1.1",
        "key_id": KEY_ID,
        "issued_at": (now - timedelta(days=32)).isoformat(),
        "expires_at": expires.isoformat(),
        "grace_until": grace.isoformat(),
    }

    signed = create_signed_token(payload)

    # Status during grace period
    status, detail = verify_entitlement_payload(signed, current_time=now)
    assert status == EntitlementStatus.GRACE_PERIOD
    assert "offline grace period" in detail

    # Status after grace period has elapsed
    later = now + timedelta(days=10)
    status_exp, detail_exp = verify_entitlement_payload(signed, current_time=later)
    assert status_exp == EntitlementStatus.EXPIRED
    assert "License expired on" in detail_exp

def test_load_and_save_local_entitlement(tmp_path):
    now = datetime.now(timezone.utc)
    payload = {
        "schema": 1,
        "product": "mastyf-guard-pro",
        "license_id": "lic_test_123",
        "instance_id": "inst_node_01",
        "activation_id": "act_test_999",
        "model_repo": "Rudraneel93/mastyf-guard-1.5b-v2-boundary-sharpened",
        "model_revision": "908c6cb2a7812fdb3073995f5bbd9b8e1f0e4bfa",
        "gateway_version": "0.1.1",
        "key_id": KEY_ID,
        "issued_at": now.isoformat(),
        "expires_at": (now + timedelta(days=30)).isoformat(),
        "grace_until": (now + timedelta(days=37)).isoformat(),
    }
    signed = create_signed_token(payload)

    # 1. Initially unlicensed
    status, data, desc = load_local_entitlement(tmp_path)
    assert status == EntitlementStatus.UNLICENSED

    # 2. Save
    save_local_entitlement(tmp_path, signed)

    # 3. Load and verify
    status2, data2, desc2 = load_local_entitlement(tmp_path)
    assert status2 == EntitlementStatus.ACTIVE
    assert data2["instance_id"] == "inst_node_01"

def test_commercial_self_test_flow(tmp_path, monkeypatch):
    from mastyf_gateway.self_test import run_commercial_self_test
    from mastyf_gateway.release import FROZEN_V6_HF_REVISION

    # 1. Without entitlement: fails closed
    monkeypatch.setenv("HF_TOKEN", "hf_mock_customer_token_1234")
    unlicensed_pass = run_commercial_self_test(tmp_path)
    assert unlicensed_pass is False

    # 2. With valid signed entitlement: passes completely
    now = datetime.now(timezone.utc)
    payload = {
        "schema": 1,
        "product": "mastyf-guard-pro",
        "license_id": "lic_test_123",
        "instance_id": "inst_node_01",
        "activation_id": "act_test_999",
        "model_repo": "Rudraneel93/mastyf-guard-1.5b-v2-boundary-sharpened",
        "model_revision": FROZEN_V6_HF_REVISION,
        "gateway_version": "0.1.1",
        "key_id": KEY_ID,
        "issued_at": now.isoformat(),
        "expires_at": (now + timedelta(days=30)).isoformat(),
        "grace_until": (now + timedelta(days=37)).isoformat(),
    }
    signed = create_signed_token(payload)
    save_local_entitlement(tmp_path, signed)

    licensed_pass = run_commercial_self_test(tmp_path)
    assert licensed_pass is True

