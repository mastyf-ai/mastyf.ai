"""Finding, verifying and starting the free check program (`mastyf-check`) on this machine.

The program is downloaded once from the project's GitHub release and run only if its SHA-256
matches the value shipped inside this package. It's started with `--exit-with-parent`, so it stops
when this process ends, however it ends.
"""

from __future__ import annotations

import hashlib
import os
import platform
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping

import httpx

from .client import MastyfUnavailable

RELEASES = "https://github.com/mastyf-ai/mastyf.ai/releases/download"
READY = re.compile(r"listening on (http://127\.0\.0\.1:\d+)")


def platform_key() -> tuple[str, str]:
    plat = {"win32": "win", "darwin": "darwin"}.get(sys.platform, "linux" if sys.platform.startswith("linux") else sys.platform)
    machine = platform.machine().lower()
    arch = "arm64" if machine in ("arm64", "aarch64") else "x64" if machine in ("x86_64", "amd64") else machine
    return plat, arch


def program_name(plat: str, arch: str) -> str:
    return f"mastyf-check-{plat}-{arch}{'.exe' if plat == 'win' else ''}"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def find_or_fetch(*, cache_dir: Path, version: str, sha256: Mapping[str, str], base_url: str, env: Mapping[str, str]) -> Path:
    """The program to run: MASTYF_CHECK_BIN if set, else a verified copy in the cache, downloading it once."""
    explicit = env.get("MASTYF_CHECK_BIN")
    if explicit:
        return Path(explicit)

    name = program_name(*platform_key())
    expected = sha256.get(name)
    if not expected:
        raise MastyfUnavailable(
            f"no verified build of the Mastyf check program for {'-'.join(platform_key())}; "
            "set MASTYF_CHECK_URL to a check service you run, or MASTYF_CHECK_BIN to a local copy"
        )

    target = cache_dir / version / name
    if target.exists() and _sha256(target) == expected:
        return target

    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_name(f".{name}.{uuid.uuid4().hex}.part")
    try:
        with httpx.stream("GET", f"{base_url.rstrip('/')}/check-v{version}/{name}", follow_redirects=True, timeout=120.0) as res:
            if res.status_code != 200:
                raise MastyfUnavailable(f"couldn't download the Mastyf check program ({res.status_code})")
            with temp.open("wb") as fh:
                for chunk in res.iter_bytes():
                    fh.write(chunk)
        if _sha256(temp) != expected:
            raise MastyfUnavailable("the downloaded Mastyf check program doesn't match its SHA-256; it was not run")
        if os.name != "nt":
            temp.chmod(0o755)
        os.replace(temp, target)  # only a verified file ever has the final name
        return target
    except httpx.HTTPError:
        raise MastyfUnavailable("couldn't download the Mastyf check program") from None
    finally:
        if temp.exists():
            temp.unlink()


@dataclass
class Running:
    url: str
    process: subprocess.Popen = field(repr=False)

    def alive(self) -> bool:
        return self.process.poll() is None

    def stop(self) -> None:
        if not self.alive():
            return
        try:
            if self.process.stdin:
                self.process.stdin.close()  # --exit-with-parent: closing stdin stops it
            self.process.wait(timeout=5)
        except Exception:
            self.process.kill()
            self.process.wait(timeout=5)


def start(path: Path, token: str, *, ready_timeout: float = 60.0) -> Running:
    """Starts `mastyf-check serve` on a free port and returns once it is listening."""
    if path.suffix in (".cjs", ".js"):
        node = shutil.which("node")
        if not node:
            raise MastyfUnavailable(f"{path.name} needs Node.js, which isn't on PATH")
        command = [node, str(path)]
    else:
        command = [str(path)]
    command += ["serve", "--port", "0", "--exit-with-parent", "--max-body", "32"]
    env = {**os.environ, "MASTYF_CHECK_TOKEN": token}
    try:
        proc = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            env=env,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except OSError as err:
        raise MastyfUnavailable(f"couldn't start the Mastyf check program: {err.strerror}") from None

    found: list[str] = []
    ready = threading.Event()

    def drain() -> None:
        # Reads the program's log for its whole life: a full pipe would stall it.
        assert proc.stderr is not None
        for raw in proc.stderr:
            if not found:
                m = READY.search(raw.decode("utf-8", "replace"))
                if m:
                    found.append(m.group(1))
                    ready.set()
        ready.set()

    threading.Thread(target=drain, name="mastyf-check-log", daemon=True).start()
    deadline = time.monotonic() + ready_timeout
    while not ready.is_set() and time.monotonic() < deadline:
        ready.wait(0.1)
    if not found:
        Running("", proc).stop()
        raise MastyfUnavailable("the Mastyf check program didn't start")
    return Running(found[0], proc)
