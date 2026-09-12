"""Unit tests for operator exception grants (OS4 approval grammar + expiry)."""

from __future__ import annotations

import time
from pathlib import Path

import pytest

from mastyf_gateway.enforcement.operator_exceptions import (
    OperatorExceptionStore,
    OperatorGrant,
    EscalationResolution,
    new_grant_id,
    new_resolution_id,
    normalize_approval_action,
    resolve_expires_at,
)


def test_normalize_approval_aliases():
    assert normalize_approval_action("allow") == "allow_once"
    assert normalize_approval_action("allow_similar") == "similar"
    assert normalize_approval_action("quarantine") == "quarantine"
    with pytest.raises(ValueError):
        normalize_approval_action("forever")


def test_resolve_expires_at_never_forever():
    now = time.time()
    exp = resolve_expires_at(action="allow_once", now=now)
    assert exp > now
    assert exp <= now + 3600 + 1
    with pytest.raises(ValueError):
        resolve_expires_at(action="allow_once", expires_at=now - 10, now=now)


def test_consume_matching_grant_once(tmp_path: Path):
    store = OperatorExceptionStore(home=tmp_path)
    g = OperatorGrant(
        grant_id=new_grant_id(),
        created_at=time.time(),
        expires_at=time.time() + 3600,
        tool_name="dangerous.tool",
        server_name="fs",
        remaining_uses=1,
        scope="once",
        reason_code="OPERATOR_ALLOW_ONCE",
    )
    store.add_grant(g)
    hit = store.consume_matching_grant(tool_name="dangerous.tool", server_name="fs")
    assert hit is not None
    assert hit.grant_id == g.grant_id
    miss = store.consume_matching_grant(tool_name="dangerous.tool", server_name="fs")
    assert miss is None


def test_find_matching_allow_grant_does_not_consume(tmp_path: Path):
    store = OperatorExceptionStore(home=tmp_path)
    g = OperatorGrant(
        grant_id=new_grant_id(),
        created_at=time.time(),
        expires_at=time.time() + 3600,
        tool_name="read_file",
        server_name="filesystem",
        remaining_uses=1,
        scope="once",
        reason_code="OPERATOR_ALLOW_ONCE",
    )
    store.add_grant(g)
    peeked = store.find_matching_allow_grant(tool_name="read_file", server_name="filesystem")
    assert peeked is not None
    assert peeked.grant_id == g.grant_id
    peeked_again = store.find_matching_allow_grant(tool_name="read_file", server_name="filesystem")
    assert peeked_again is not None
    hit = store.consume_matching_grant(tool_name="read_file", server_name="filesystem")
    assert hit is not None
    assert store.find_matching_allow_grant(tool_name="read_file", server_name="filesystem") is None


def test_expired_grant_not_consumed(tmp_path: Path):
    store = OperatorExceptionStore(home=tmp_path)
    g = OperatorGrant(
        grant_id=new_grant_id(),
        created_at=time.time() - 10,
        expires_at=time.time() - 1,
        tool_name="dangerous.tool",
        remaining_uses=5,
        scope="similar",
    )
    store.add_grant(g)
    assert store.consume_matching_grant(tool_name="dangerous.tool") is None


def test_deny_grant_block(tmp_path: Path):
    store = OperatorExceptionStore(home=tmp_path)
    g = OperatorGrant(
        grant_id=new_grant_id(),
        created_at=time.time(),
        expires_at=time.time() + 3600,
        tool_name="dangerous.tool",
        remaining_uses=100,
        scope="block",
        reason_code="OPERATOR_BLOCK",
    )
    store.add_grant(g)
    deny = store.find_deny_grant(tool_name="dangerous.tool")
    assert deny is not None
    assert deny.scope == "block"


def test_add_grant_requires_expires_at(tmp_path: Path):
    store = OperatorExceptionStore(home=tmp_path)
    g = OperatorGrant(
        grant_id=new_grant_id(),
        created_at=time.time(),
        expires_at=None,
        tool_name="x",
        remaining_uses=1,
        scope="once",
    )
    with pytest.raises(ValueError):
        store.add_grant(g)


def test_resolution_ledger(tmp_path: Path):
    store = OperatorExceptionStore(home=tmp_path)
    r = EscalationResolution(
        resolution_id=new_resolution_id(),
        timestamp=time.time(),
        receipt_id="rcpt-1",
        action="allow_once",
        grant_id="grant_x",
        expires_at=time.time() + 3600,
    )
    store.record_resolution(r)
    assert store.get_resolution_for_receipt("rcpt-1") is not None
    assert store.get_resolution_for_receipt("missing") is None
