"""The wheel people install from PyPI: licence, version, command, and nothing of the old 4.x client."""

import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

PACKAGE = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def wheel(tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp("dist")
    uv = shutil.which("uv")
    if uv:
        cmd = [uv, "build", "--wheel", "--out-dir", str(out), str(PACKAGE)]
    else:
        pytest.importorskip("build")
        cmd = [sys.executable, "-m", "build", "--wheel", "--outdir", str(out), str(PACKAGE)]
    subprocess.run(cmd, check=True, capture_output=True, timeout=300)
    (built,) = out.glob("mastyf_ai-*.whl")
    return built


def read(whl: Path, suffix: str) -> str:
    with zipfile.ZipFile(whl) as z:
        (name,) = [n for n in z.namelist() if n.endswith(suffix)]
        return z.read(name).decode("utf-8")


def test_the_wheel_is_mit_version_5(wheel):
    meta = read(wheel, ".dist-info/METADATA")
    assert "Version: 5.1.0" in meta
    assert "License-Expression: MIT" in meta or "License: MIT" in meta


def test_the_command_is_installed(wheel):
    assert "mastyf-ai = mastyf_ai.cli:main" in read(wheel, ".dist-info/entry_points.txt")


def test_nothing_of_the_old_proxy_client_ships(wheel):
    with zipfile.ZipFile(wheel) as z:
        for name in z.namelist():
            if name.endswith(".py"):
                assert "localhost:4000" not in z.read(name).decode("utf-8"), name
        assert not any("/tests/" in n or n.startswith("tests/") for n in z.namelist())
