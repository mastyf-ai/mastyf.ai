"""Shared test helpers: a small fake check service on 127.0.0.1."""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable

import pytest

TOKEN = "t" * 43


class FakeService:
    """Answers the check API from a handler function; records every request."""

    def __init__(self, respond: Callable[[str, dict | None], tuple[int, Any]]):
        self.requests: list[dict[str, Any]] = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args: Any) -> None:  # quiet
                pass

            def _handle(self) -> None:
                length = int(self.headers.get("content-length") or 0)
                raw = self.rfile.read(length) if length else b""
                body = json.loads(raw) if raw else None
                outer.requests.append({"path": self.path, "auth": self.headers.get("authorization"), "body": body})
                status, payload = respond(self.path, body)
                data = json.dumps(payload).encode() if not isinstance(payload, bytes) else payload
                self.send_response(status)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            do_GET = _handle
            do_POST = _handle

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def fake_service():
    started: list[FakeService] = []

    def make(respond: Callable[[str, dict | None], tuple[int, Any]]) -> FakeService:
        s = FakeService(respond)
        started.append(s)
        return s

    yield make
    for s in started:
        s.close()
