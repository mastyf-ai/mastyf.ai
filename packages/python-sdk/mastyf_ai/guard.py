"""`Guard`: checks an agent's tool calls and results.

One check service is shared by every Guard in the process. Each Guard is one agent run (its own
session), so two agents in one process don't affect each other's session checks.
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import secrets
import threading
import uuid
from pathlib import Path
from typing import Any, Iterator, Literal

from . import discovery, program
from ._check_sha256 import CHECK_VERSION, SHA256
from .client import CheckClient, MastyfUnavailable
from .verdict import Verdict

log = logging.getLogger("mastyf_ai")

_lock = threading.Lock()
_client: CheckClient | None = None
_tier: str | None = None
_started: program.Running | None = None


def _home() -> Path:
    return Path(os.environ.get("HOME") or os.environ.get("USERPROFILE") or Path.home())


def _connect() -> None:
    """Finds a check service (see discovery) and remembers it. Raises MastyfUnavailable when there is none."""
    global _client, _tier, _started
    env = dict(os.environ)
    found = discovery.configured(env) or discovery.running_local(env, _home()) or discovery._shield_client()
    if found:
        _client, _tier = found.client, found.tier
        return
    path = program.find_or_fetch(
        cache_dir=_home() / ".mastyf" / "check" / "bin",
        version=CHECK_VERSION,
        sha256=SHA256,
        base_url=env.get("MASTYF_CHECK_RELEASES", program.RELEASES),
        env=env,
    )
    if not path.exists():
        raise MastyfUnavailable(f"the Mastyf check program wasn't found at {path}")
    token = secrets.token_urlsafe(32)
    _started = program.start(path, token)
    _client, _tier = CheckClient(_started.url, token), "free"


def _service(*, reconnect: bool = False) -> CheckClient:
    global _client
    with _lock:
        if reconnect or _client is None or (_started is not None and not _started.alive()):
            _client = None
            _connect()
        assert _client is not None
        return _client


def _running() -> program.Running | None:
    """The check program this process started, if any (for tests and diagnostics)."""
    return _started


def _reset_for_tests() -> None:
    global _client, _tier, _started
    with _lock:
        if _started is not None:
            _started.stop()
        _client, _tier, _started = None, None, None


def _jsonable(value: Any) -> Any:
    """Anything a tool returns, in a form the check can read; nothing is ever skipped."""
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8", "replace")
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(v) for v in value]
    for attr in ("page_content", "content", "text"):
        inner = getattr(value, attr, None)
        if isinstance(inner, (str, bytes, list, dict)):
            return {"type": type(value).__name__, attr: _jsonable(inner)}
    for dump in ("model_dump", "dict", "to_dict"):
        fn = getattr(value, dump, None)
        if callable(fn):
            try:
                return _jsonable(fn())
            except Exception:
                pass
    try:
        json.dumps(value)
        return value
    except (TypeError, ValueError):
        return str(value)


def _arguments(arguments: Any) -> dict[str, Any]:
    if isinstance(arguments, dict):
        return _jsonable(arguments)
    return {"input": _jsonable(arguments)}


class Guard:
    """Checks one agent run's tool calls and results.

    on_unavailable="block" (default): with no check service, calls raise MastyfUnavailable instead of
    running unchecked. "allow" lets them through and logs a warning each time.
    """

    def __init__(self, session: str | None = None, on_unavailable: Literal["block", "allow"] = "block", server: str = "agent"):
        self.session_id = session or uuid.uuid4().hex
        self.on_unavailable = on_unavailable
        self.server = server

    @property
    def tier(self) -> str | None:
        """"free" or "shield" once a check service is in use."""
        return _tier

    @contextlib.contextmanager
    def session(self, name: str) -> Iterator["Guard"]:
        previous, self.session_id = self.session_id, name
        try:
            yield self
        finally:
            self.session_id = previous

    def check_call(self, tool: str, arguments: Any) -> Verdict:
        return self._ask(lambda c: c.check_call(tool, _arguments(arguments), server=self.server, session=self.session_id))

    def check_result(self, tool: str, result: Any, arguments: Any = None) -> Verdict:
        args = None if arguments is None else _arguments(arguments)
        return self._ask(lambda c: c.check_result(tool, _jsonable(result), arguments=args, server=self.server, session=self.session_id))

    def register_tools(self, tools: list[dict[str, Any]]) -> Verdict | None:
        try:
            return _service().register_tools(self.server, _jsonable(tools), session=self.session_id)
        except MastyfUnavailable:
            if self.on_unavailable == "allow":
                log.warning("Mastyf: tool definitions not checked (no check service)")
                return None
            raise

    def _ask(self, ask) -> Verdict:
        try:
            try:
                return ask(_service())
            except MastyfUnavailable:
                if _started is None:
                    raise
                return ask(_service(reconnect=True))  # the program this process started died: once more
        except MastyfUnavailable as err:
            if self.on_unavailable == "allow":
                log.warning("Mastyf: tool call not checked (%s)", err)
                return Verdict(decision="allow", id="unavailable", reason="not checked: no check service")
            raise
