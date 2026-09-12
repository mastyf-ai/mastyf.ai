"""
Operator exception grants for human-resolved escalations.

Approval grammar (OS4):
  ALLOW ONCE | SESSION | SIMILAR | DESTINATION | TOOL | BLOCK | QUARANTINE
Each grant carries operator, scope, expires_at, and is audited via control receipt.
Default never forever — TTL always applied.
"""

from __future__ import annotations

import json
import secrets
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Canonical approval actions (API accepts aliases).
APPROVAL_ACTIONS = (
    "allow_once",
    "session",
    "similar",
    "destination",
    "tool",
    "block",
    "quarantine",
)

ACTION_ALIASES = {
    "allow": "allow_once",
    "allow_once": "allow_once",
    "once": "allow_once",
    "session": "session",
    "allow_session": "session",
    "similar": "similar",
    "allow_similar": "similar",
    "destination": "destination",
    "allow_destination": "destination",
    "tool": "tool",
    "allow_tool": "tool",
    "block": "block",
    "quarantine": "quarantine",
}

# Default TTL — never forever.
DEFAULT_TTL_SECONDS: Dict[str, int] = {
    "allow_once": 3600,       # 1h (still single-use)
    "session": 4 * 3600,      # 4h
    "similar": 3600,
    "destination": 3600,
    "tool": 3600,
    "block": 30 * 86400,      # 30d
    "quarantine": 7 * 86400,  # 7d
}
MAX_TTL_SECONDS = 90 * 86400

DENY_SCOPES = frozenset({"block", "quarantine", "permanent_block"})
ALLOW_SCOPES = frozenset({"once", "session", "similar", "destination", "tool"})


def normalize_approval_action(action: str) -> str:
    key = (action or "").strip().lower()
    if key not in ACTION_ALIASES:
        raise ValueError(
            f"action must be one of {list(APPROVAL_ACTIONS)} (aliases: allow, allow_similar)"
        )
    return ACTION_ALIASES[key]


def resolve_expires_at(
    *,
    action: str,
    ttl_seconds: Optional[int] = None,
    expires_at: Optional[float] = None,
    now: Optional[float] = None,
) -> float:
    """Always return a finite expires_at. Rejects forever / missing expiry."""
    t0 = now if now is not None else time.time()
    if expires_at is not None:
        exp = float(expires_at)
        if exp <= t0:
            raise ValueError("expires_at must be in the future")
        if exp - t0 > MAX_TTL_SECONDS:
            return t0 + MAX_TTL_SECONDS
        return exp
    ttl = ttl_seconds if ttl_seconds is not None else DEFAULT_TTL_SECONDS[action]
    ttl = max(60, min(int(ttl), MAX_TTL_SECONDS))
    return t0 + ttl


def scope_for_action(action: str) -> str:
    return {
        "allow_once": "once",
        "session": "session",
        "similar": "similar",
        "destination": "destination",
        "tool": "tool",
        "block": "block",
        "quarantine": "quarantine",
    }[action]


def reason_for_action(action: str) -> str:
    return {
        "allow_once": "OPERATOR_ALLOW_ONCE",
        "session": "OPERATOR_ALLOW_SESSION",
        "similar": "OPERATOR_ALLOW_SIMILAR",
        "destination": "OPERATOR_ALLOW_DESTINATION",
        "tool": "OPERATOR_ALLOW_TOOL",
        "block": "OPERATOR_BLOCK",
        "quarantine": "OPERATOR_QUARANTINE",
    }[action]


@dataclass
class OperatorGrant:
    grant_id: str
    created_at: float
    expires_at: Optional[float]  # required for new grants; Optional for legacy reads
    tool_name: str
    server_id: Optional[str] = None
    server_name: Optional[str] = None
    principal_id: Optional[str] = None
    session_id: Optional[str] = None
    destination: Optional[str] = None
    source_receipt_id: Optional[str] = None
    remaining_uses: int = 1
    scope: str = "once"  # once | session | similar | destination | tool | block | quarantine
    reason_code: str = "OPERATOR_ALLOW_ONCE"
    operator: str = "control_client"
    details: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "OperatorGrant":
        return cls(
            grant_id=data["grant_id"],
            created_at=float(data["created_at"]),
            expires_at=data.get("expires_at"),
            tool_name=data["tool_name"],
            server_id=data.get("server_id"),
            server_name=data.get("server_name"),
            principal_id=data.get("principal_id"),
            session_id=data.get("session_id"),
            destination=data.get("destination"),
            source_receipt_id=data.get("source_receipt_id"),
            remaining_uses=int(data.get("remaining_uses", 1)),
            scope=data.get("scope", "once"),
            reason_code=data.get("reason_code", "OPERATOR_ALLOW_ONCE"),
            operator=data.get("operator", "control_client"),
            details=data.get("details") or {},
        )

    def is_expired(self, now: Optional[float] = None) -> bool:
        t0 = now if now is not None else time.time()
        # Legacy forever grants (expires_at None) treated as expired for safety (OS4).
        if self.expires_at is None:
            return True
        return self.expires_at <= t0


@dataclass
class EscalationResolution:
    resolution_id: str
    timestamp: float
    receipt_id: str
    action: str  # normalized approval action
    grant_id: Optional[str] = None
    actor: str = "operator"
    expires_at: Optional[float] = None
    details: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "EscalationResolution":
        return cls(
            resolution_id=data["resolution_id"],
            timestamp=float(data["timestamp"]),
            receipt_id=data["receipt_id"],
            action=data["action"],
            grant_id=data.get("grant_id"),
            actor=data.get("actor", "operator"),
            expires_at=data.get("expires_at"),
            details=data.get("details") or {},
        )


class OperatorExceptionStore:
    """File-backed grants + escalation resolution ledger."""

    def __init__(self, home: Optional[Path] = None):
        self.home = home or (Path.home() / ".mastyf")
        self.home.mkdir(parents=True, exist_ok=True)
        self.grants_file = self.home / "operator_grants.jsonl"
        self.resolutions_file = self.home / "escalation_resolutions.jsonl"
        self._lock = threading.Lock()

    def _read_grants(self) -> List[OperatorGrant]:
        if not self.grants_file.exists():
            return []
        out: List[OperatorGrant] = []
        with open(self.grants_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(OperatorGrant.from_dict(json.loads(line)))
                except Exception:
                    continue
        return out

    def _write_grants(self, grants: List[OperatorGrant]) -> None:
        with open(self.grants_file, "w", encoding="utf-8") as f:
            for g in grants:
                f.write(json.dumps(g.to_dict()) + "\n")

    def list_active_grants(self) -> List[OperatorGrant]:
        now = time.time()
        with self._lock:
            grants = self._read_grants()
            return [g for g in grants if g.remaining_uses > 0 and not g.is_expired(now)]

    def list_all_grants(self, limit: int = 500) -> List[OperatorGrant]:
        with self._lock:
            grants = self._read_grants()
            return grants[-max(1, min(limit, 5000)) :]

    def list_all_grants(self, limit: int = 200) -> List[OperatorGrant]:
        with self._lock:
            grants = self._read_grants()
            grants.sort(key=lambda g: float(g.created_at or 0), reverse=True)
            return grants[:limit]

    def add_grant(self, grant: OperatorGrant) -> OperatorGrant:
        if grant.expires_at is None:
            raise ValueError("expires_at required — default never forever")
        with self._lock:
            grants = self._read_grants()
            grants.append(grant)
            self._write_grants(grants)
            return grant

    def record_resolution(self, resolution: EscalationResolution) -> EscalationResolution:
        with self._lock:
            with open(self.resolutions_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(resolution.to_dict()) + "\n")
            return resolution

    def get_resolution_for_receipt(self, receipt_id: str) -> Optional[EscalationResolution]:
        if not self.resolutions_file.exists():
            return None
        last: Optional[EscalationResolution] = None
        with open(self.resolutions_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = EscalationResolution.from_dict(json.loads(line))
                except Exception:
                    continue
                if r.receipt_id == receipt_id:
                    last = r
        return last

    def list_resolutions(self) -> List[EscalationResolution]:
        if not self.resolutions_file.exists():
            return []
        out: List[EscalationResolution] = []
        with open(self.resolutions_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(EscalationResolution.from_dict(json.loads(line)))
                except Exception:
                    continue
        return out

    def _matches(
        self,
        g: OperatorGrant,
        *,
        tool_name: str,
        server_id: Optional[str],
        server_name: Optional[str],
        principal_id: Optional[str],
        session_id: Optional[str],
        destination: Optional[str],
    ) -> bool:
        if g.scope == "tool":
            return g.tool_name == tool_name
        if g.scope == "destination":
            if not g.destination or not destination:
                return False
            gl = g.destination.lower()
            dl = destination.lower()
            return gl in dl or dl in gl
        if g.scope == "session":
            if not g.session_id or not session_id or g.session_id != session_id:
                return False
            return g.tool_name in ("*", tool_name)
        if g.scope in ("once", "similar", "block", "quarantine"):
            if g.tool_name not in ("*", tool_name):
                return False
            if g.server_id and server_id and g.server_id != server_id:
                return False
            if g.server_name and server_name and g.server_name != server_name:
                return False
            if g.principal_id and principal_id and g.principal_id != principal_id:
                return False
            if g.destination and destination:
                if g.destination.lower() not in destination.lower():
                    return False
            return True
        return False

    def find_deny_grant(
        self,
        *,
        tool_name: str,
        server_id: Optional[str] = None,
        server_name: Optional[str] = None,
        principal_id: Optional[str] = None,
        session_id: Optional[str] = None,
        destination: Optional[str] = None,
    ) -> Optional[OperatorGrant]:
        now = time.time()
        with self._lock:
            for g in self._read_grants():
                if g.scope not in DENY_SCOPES:
                    continue
                if g.remaining_uses <= 0:
                    continue
                if g.is_expired(now):
                    continue
                if self._matches(
                    g,
                    tool_name=tool_name,
                    server_id=server_id,
                    server_name=server_name,
                    principal_id=principal_id,
                    session_id=session_id,
                    destination=destination,
                ):
                    return g
        return None

    def find_matching_allow_grant(
        self,
        *,
        tool_name: str,
        server_id: Optional[str] = None,
        server_name: Optional[str] = None,
        principal_id: Optional[str] = None,
        session_id: Optional[str] = None,
        destination: Optional[str] = None,
    ) -> Optional[OperatorGrant]:
        """Peek one matching unused allow grant. Does not consume."""
        now = time.time()
        with self._lock:
            for g in self._read_grants():
                if g.scope in DENY_SCOPES:
                    continue
                if g.remaining_uses <= 0:
                    continue
                if g.is_expired(now):
                    continue
                if self._matches(
                    g,
                    tool_name=tool_name,
                    server_id=server_id,
                    server_name=server_name,
                    principal_id=principal_id,
                    session_id=session_id,
                    destination=destination,
                ):
                    return g
        return None

    def consume_matching_grant(
        self,
        *,
        tool_name: str,
        server_id: Optional[str] = None,
        server_name: Optional[str] = None,
        principal_id: Optional[str] = None,
        session_id: Optional[str] = None,
        destination: Optional[str] = None,
    ) -> Optional[OperatorGrant]:
        """Find and consume one matching allow grant. Returns the grant if consumed."""
        now = time.time()
        with self._lock:
            grants = self._read_grants()
            matched_idx: Optional[int] = None
            for i, g in enumerate(grants):
                if g.scope in DENY_SCOPES:
                    continue
                if g.remaining_uses <= 0:
                    continue
                if g.is_expired(now):
                    continue
                if not self._matches(
                    g,
                    tool_name=tool_name,
                    server_id=server_id,
                    server_name=server_name,
                    principal_id=principal_id,
                    session_id=session_id,
                    destination=destination,
                ):
                    continue
                matched_idx = i
                break
            if matched_idx is None:
                return None
            g = grants[matched_idx]
            # session / similar / destination / tool: decrement but may have many uses
            g.remaining_uses -= 1
            self._write_grants(grants)
            return g


def new_grant_id() -> str:
    return f"grant_{secrets.token_hex(8)}"


def new_resolution_id() -> str:
    return f"escres_{secrets.token_hex(8)}"


_STORE: Optional[OperatorExceptionStore] = None


def get_operator_exception_store() -> OperatorExceptionStore:
    global _STORE
    if _STORE is None:
        _STORE = OperatorExceptionStore()
    return _STORE
