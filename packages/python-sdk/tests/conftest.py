"""Shared test helpers: a small fake check service on 127.0.0.1."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable

import pytest

TOKEN = "t" * 43

REPO = Path(__file__).resolve().parents[3]
CHECK_BUNDLE = REPO / "packages" / "check" / "dist" / "mastyf-check.cjs"


@pytest.fixture(scope="session")
def check_bundle() -> Path:
    """The free check service as a Node bundle (built from this repository if missing)."""
    if not CHECK_BUNDLE.exists():
        subprocess.run(["node", "esbuild.mjs"], cwd=CHECK_BUNDLE.parents[1], check=True)
    return CHECK_BUNDLE


@pytest.fixture
def isolated_home(tmp_path, monkeypatch):
    """A clean home and environment: no running service is found, nothing from the real machine leaks in."""
    for name in ("MASTYF_CHECK_URL", "MASTYF_CHECK_TOKEN", "MASTYF_CHECK_BIN"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData" / "Roaming"))
    return tmp_path


def pid_alive(pid: int) -> bool:
    """Whether a process exists, without ever signalling it (os.kill on Windows terminates)."""
    if sys.platform == "win32":
        import ctypes

        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        STILL_ACTIVE = 259
        handle = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not handle:
            return False
        try:
            code = ctypes.c_ulong()
            ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
            return code.value == STILL_ACTIVE
        finally:
            ctypes.windll.kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


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
