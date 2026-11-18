"""`Guard`: checks an agent's tool calls and results.

One check service is shared by every Guard in the process. Each Guard is one agent run (its own
session), so two agents in one process don't affect each other's session checks.
"""

from __future__ import annotations

import contextlib
import contextvars
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
from .client import CheckClient, MastyfRefused, MastyfUnavailable
from .verdict import Verdict

log = logging.getLogger("mastyf_ai")

_lock = threading.Lock()
_client: CheckClient | None = None
_tier: str | None = None
_started: program.Running | None = None
ENGINE_MAX_BODY_MB = 32  # what the started program accepts (--max-body)
REFUSED = Verdict(decision="block", id="refused", layer="service", rule="input-refused", reason="the check service refused this input")


def _home() -> Path:
    return Path(os.environ.get("HOME") or os.environ.get("USERPROFILE") or Path.home())


def _connect() -> None:
    """Finds a check service (see discovery) and remembers it. Raises MastyfUnavailable when there is none."""
    global _client, _tier, _started
    env = dict(os.environ)
    found = discovery.configured(env) or discovery.shield_client(env, _home()) or discovery.running_local(env, _home())
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
    if _started is not None:
        _started.stop()  # never leave an old one behind
        _started = None
    token = secrets.token_urlsafe(32)
    _started = program.start(path, token)
    _client, _tier = CheckClient(_started.url, token, max_body_bytes=ENGINE_MAX_BODY_MB * 1024 * 1024), "free"


def _service() -> CheckClient:
    global _client
    with _lock:
        if _client is None or (_started is not None and not _started.alive()):
            _client = None
            _connect()
        assert _client is not None
        return _client


def _retry_client(failed: CheckClient) -> CheckClient | None:
    """After `failed` didn't answer: the client to try once more, or None to give up.

    Only the program this process started is restarted, only when it has really died, and only
    once however many checks saw it die: later ones get the client the first one made.
    """
    global _client
    with _lock:
        if _started is None:
            return None
        if _client is not None and _client is not failed:
            return _client
        if _started.alive():
            return None
        _client = None
        _connect()
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
    # Objects: every field goes to the check, not just the text one (metadata can carry text too).
    out: dict[str, Any] = {"type": type(value).__name__}
    for dump in ("model_dump", "dict", "to_dict"):
        fn = getattr(value, dump, None)
        if callable(fn):
            try:
                dumped = fn()
            except Exception:
                continue
            if isinstance(dumped, dict):
                out.update({str(k): _jsonable(v) for k, v in dumped.items()})
                break
    else:
        fields = getattr(value, "__dict__", None)
        if isinstance(fields, dict):
            out.update({str(k): _jsonable(v) for k, v in fields.items()})
    for attr in ("page_content", "content", "text"):
        if attr not in out:
            inner = getattr(value, attr, None)
            if isinstance(inner, (str, bytes, list, dict)):
                out[attr] = _jsonable(inner)
    if len(out) > 1:
        base: Any = out
    else:
        try:
            json.dumps(value)
            base = value
        except (TypeError, ValueError):
            base = str(value)
    # Frameworks show the model str(object) (for a dataclass, its repr with every field): check
    # that text as well, beside the fields, so nothing the model is shown escapes the check.
    try:
        return {"value": base, "shown": str(value)}
    except Exception:
        return base


def _arguments(arguments: Any) -> dict[str, Any]:
    if isinstance(arguments, dict):
        return _jsonable(arguments)
    return {"input": _jsonable(arguments)}


class Guard:
    """Checks one agent run's tool calls and results.

    on_unavailable="block" (default): with no check service, calls raise MastyfUnavailable instead of
    running unchecked. "allow" lets them through and logs a warning each time.
    """

    def __init__(
        self,
        session: str | None = None,
        on_unavailable: Literal["block", "allow"] = "block",
        server: str = "agent",
        agent: str | None = None,
    ):
        self._default_session = session or uuid.uuid4().hex
        # Per task/thread context, so concurrent runs sharing this Guard keep their own sessions.
        self._session: contextvars.ContextVar[str | None] = contextvars.ContextVar(f"mastyf_session_{id(self)}", default=None)
        self.on_unavailable = on_unavailable
        self.server = server
        # This agent's name, shown in Shield's dashboard. Defaults to MASTYF_AI_AGENT.
        self.agent = agent or os.environ.get("MASTYF_AI_AGENT") or None

    @property
    def tier(self) -> str | None:
        """"free" or "shield" once a check service is in use."""
        return _tier

    @property
    def session_id(self) -> str:
        return self._session.get() or self._default_session

    @contextlib.contextmanager
    def session(self, name: str) -> Iterator["Guard"]:
        """Checks inside this block (in this task or thread) belong to session `name`.

        A long-lived agent that serves many users should open one per request."""
        token = self._session.set(name)
        try:
            yield self
        finally:
            self._session.reset(token)

    def check_call(self, tool: str, arguments: Any) -> Verdict:
        return self._ask(lambda c: c.check_call(tool, _arguments(arguments), server=self.server, session=self.session_id, agent=self.agent))

    def check_result(self, tool: str, result: Any, arguments: Any = None) -> Verdict:
        args = None if arguments is None else _arguments(arguments)
        return self._ask(lambda c: c.check_result(tool, _jsonable(result), arguments=args, server=self.server, session=self.session_id, agent=self.agent))

    def register_tools(self, tools: list[dict[str, Any]]) -> Verdict | None:
        return self._ask(
            lambda c: c.register_tools(self.server, _jsonable(tools), session=self.session_id), unchecked=None, what="tool definitions"
        )

    def _ask(self, ask, unchecked: Any = ..., what: str = "tool call") -> Any:
        try:
            client = _service()
            try:
                return ask(client)
            except MastyfRefused:
                raise
            except MastyfUnavailable:
                retry = _retry_client(client)
                if retry is None:
                    raise
                return ask(retry)  # the program this process started died: once more
        except MastyfRefused:
            return REFUSED  # an input the service won't take is never let through, in either mode
        except MastyfUnavailable as err:
            if self.on_unavailable == "allow":
                log.warning("Mastyf: %s not checked (%s)", what, err)
                if unchecked is ...:
                    return Verdict(decision="allow", id="unavailable", reason="not checked: no check service")
                return unchecked
            raise
