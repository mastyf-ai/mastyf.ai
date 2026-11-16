"""HTTP client for a Mastyf check service (the free service on this machine, or the Shield app)."""

from __future__ import annotations

from typing import Any

import httpx

from .verdict import Verdict


class MastyfUnavailable(Exception):
    """No check could be made: the service is missing, refused the request, or failed."""


class CheckClient:
    def __init__(self, url: str, token: str, timeout: float = 10.0):
        self.url = url.rstrip("/")
        self._token = token
        self._http = httpx.Client(timeout=timeout, follow_redirects=False)

    def close(self) -> None:
        self._http.close()

    # -- checks -----------------------------------------------------------------------------

    def check_call(self, tool: str, arguments: dict[str, Any], *, server: str, session: str) -> Verdict:
        return self._verdict("/v1/check/call", {"tool": tool, "arguments": arguments, "server": server, "session": session})

    def check_result(
        self,
        tool: str,
        result: Any,
        *,
        arguments: dict[str, Any] | None = None,
        server: str,
        session: str,
    ) -> Verdict:
        body: dict[str, Any] = {"tool": tool, "result": result, "server": server, "session": session}
        if arguments is not None:
            body["arguments"] = arguments
        return self._verdict("/v1/check/result", body)

    def register_tools(self, server: str, tools: list[dict[str, Any]], *, session: str) -> Verdict | None:
        """Tells the service what a server offers. Returns the verdict when the list is blocked or redacted."""
        v = self._verdict("/v1/tools", {"server": server, "tools": tools, "session": session})
        return None if v.decision == "allow" else v

    def health(self) -> dict[str, Any] | None:
        try:
            res = self._http.get(f"{self.url}/v1/health")
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
        try:
            res = self._http.post(f"{self.url}{path}", json=body, headers={"authorization": f"Bearer {self._token}"})
        except httpx.HTTPError as err:
            # The message never includes the request: it carries the token and the tool's data.
            raise MastyfUnavailable(f"the check service at {self.url} didn't answer ({type(err).__name__})") from None
        if res.status_code != 200:
            raise MastyfUnavailable(f"the check service at {self.url} answered {res.status_code}")
        try:
            return Verdict.from_json(res.json())
        except ValueError:
            raise MastyfUnavailable(f"the check service at {self.url} sent an answer that isn't a verdict") from None
