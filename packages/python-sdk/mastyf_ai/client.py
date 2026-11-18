"""HTTP client for a Mastyf check service (the free service on this machine, or the Shield app)."""

from __future__ import annotations

import json
from typing import Any

import httpx

from .verdict import Verdict


DEFAULT_SERVICE_LIMIT = 2 * 1024 * 1024  # what a check service accepts unless it says otherwise


class MastyfUnavailable(Exception):
    """No check could be made: the service is missing, refused the request, or failed."""


class MastyfRefused(MastyfUnavailable):
    """The service refused this particular input (too large or malformed). Never a reason to let it through."""


class CheckClient:
    def __init__(self, url: str, token: str, timeout: float = 10.0, max_body_bytes: int | None = None):
        self.url = url.rstrip("/")
        self._token = token
        self._max_body = max_body_bytes
        self._http = httpx.Client(timeout=timeout, follow_redirects=False)

    def limit_body(self, max_body_bytes: Any) -> None:
        """Use the request size limit the service reported (from /v1/health)."""
        if isinstance(max_body_bytes, int) and not isinstance(max_body_bytes, bool) and max_body_bytes > 0:
            self._max_body = max_body_bytes

    def close(self) -> None:
        self._http.close()

    # -- checks -----------------------------------------------------------------------------

    def check_call(self, tool: str, arguments: dict[str, Any], *, server: str, session: str, agent: str | None = None) -> Verdict:
        body: dict[str, Any] = {"tool": tool, "arguments": arguments, "server": server, "session": session}
        if agent:
            body["agent"] = agent
        return self._verdict("/v1/check/call", body)

    def check_result(
        self,
        tool: str,
        result: Any,
        *,
        arguments: dict[str, Any] | None = None,
        server: str,
        session: str,
        agent: str | None = None,
    ) -> Verdict:
        body: dict[str, Any] = {"tool": tool, "result": result, "server": server, "session": session}
        if agent:
            body["agent"] = agent
        if arguments is not None:
            body["arguments"] = arguments
        return self._verdict("/v1/check/result", body)

    def register_tools(self, server: str, tools: list[dict[str, Any]], *, session: str) -> Verdict | None:
        """Tells the service what a server offers. Returns the verdict when the list is blocked or redacted."""
        v = self._verdict("/v1/tools", {"server": server, "tools": tools, "session": session})
        return None if v.decision == "allow" else v

    def health(self, nonce: str | None = None) -> dict[str, Any] | None:
        """The service's health (no token sent). With a nonce, a service that knows the token adds
        "proof": the HMAC-SHA256 of the nonce keyed by the token."""
        try:
            res = self._http.get(f"{self.url}/v1/health", params={"nonce": nonce} if nonce else None)
        except httpx.HTTPError:
            return None
        if res.status_code != 200:
            return None
        try:
            data = res.json()
        except ValueError:
            return None
        return data if isinstance(data, dict) else None

    # -- internals --------------------------------------------------------------------------

    def _verdict(self, path: str, body: dict[str, Any]) -> Verdict:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        if self._max_body is not None and len(data) > self._max_body:
            raise MastyfRefused(f"the input is larger than the check service accepts ({len(data)} bytes)")
        try:
            res = self._http.post(
                f"{self.url}{path}", content=data, headers={"authorization": f"Bearer {self._token}", "content-type": "application/json"}
            )
        except httpx.HTTPError as err:
            if len(data) > DEFAULT_SERVICE_LIMIT:
                # A service that doesn't report its limit drops an oversize upload mid-way.
                raise MastyfRefused(f"the check service at {self.url} didn't take an input of {len(data)} bytes") from None
            # The message never includes the request: it carries the token and the tool's data.
            raise MastyfUnavailable(f"the check service at {self.url} didn't answer ({type(err).__name__})") from None
        if res.status_code in (400, 413):
            raise MastyfRefused(f"the check service at {self.url} refused this input ({res.status_code})")
        if res.status_code != 200:
            raise MastyfUnavailable(f"the check service at {self.url} answered {res.status_code}")
        try:
            return Verdict.from_json(res.json())
        except ValueError:
            raise MastyfUnavailable(f"the check service at {self.url} sent an answer that isn't a verdict") from None
