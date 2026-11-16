import hashlib
import sys
from pathlib import Path

import pytest

from mastyf_ai import program
from mastyf_ai.client import MastyfUnavailable

GOOD = b"#!/bin/sh\necho good\n"
TAMPERED = b"#!/bin/sh\necho tampered\n"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def test_platform_file_names():
    assert program.program_name("win", "x64") == "mastyf-check-win-x64.exe"
    assert program.program_name("linux", "arm64") == "mastyf-check-linux-arm64"
    assert program.program_name("darwin", "arm64") == "mastyf-check-darwin-arm64"


def test_downloads_verifies_and_caches(fake_service, tmp_path):
    key = program.platform_key()
    name = program.program_name(*key)
    svc = fake_service(lambda path, body: (200, GOOD) if path.endswith(name) else (404, b""))
    got = program.find_or_fetch(cache_dir=tmp_path, version="0.1.0", sha256={name: sha(GOOD)}, base_url=svc.url, env={})
    assert got.read_bytes() == GOOD
    assert svc.requests[0]["path"] == f"/check-v0.1.0/{name}"
    # A second call uses the cache: no new download.
    program.find_or_fetch(cache_dir=tmp_path, version="0.1.0", sha256={name: sha(GOOD)}, base_url=svc.url, env={})
    assert len(svc.requests) == 1


def test_a_tampered_download_is_refused_and_removed(fake_service, tmp_path):
    name = program.program_name(*program.platform_key())
    svc = fake_service(lambda path, body: (200, TAMPERED))
    with pytest.raises(MastyfUnavailable, match="SHA-256"):
        program.find_or_fetch(cache_dir=tmp_path, version="0.1.0", sha256={name: sha(GOOD)}, base_url=svc.url, env={})
    assert list(tmp_path.rglob("*")) == [] or all(p.is_dir() for p in tmp_path.rglob("*"))


def test_a_tampered_cached_file_is_downloaded_again(fake_service, tmp_path):
    name = program.program_name(*program.platform_key())
    cached = tmp_path / "0.1.0" / name
    cached.parent.mkdir(parents=True)
    cached.write_bytes(TAMPERED)
    svc = fake_service(lambda path, body: (200, GOOD))
    got = program.find_or_fetch(cache_dir=tmp_path, version="0.1.0", sha256={name: sha(GOOD)}, base_url=svc.url, env={})
    assert got.read_bytes() == GOOD


def test_no_verified_build_for_this_platform(tmp_path):
    with pytest.raises(MastyfUnavailable, match="no verified build"):
        program.find_or_fetch(cache_dir=tmp_path, version="0.1.0", sha256={}, base_url="http://127.0.0.1:9", env={})


def test_mastyf_check_bin_is_used_as_given(tmp_path):
    p = tmp_path / "mastyf-check.cjs"
    p.write_text("x")
    assert program.find_or_fetch(cache_dir=tmp_path, version="0.1.0", sha256={}, base_url="x", env={"MASTYF_CHECK_BIN": str(p)}) == p


def test_starts_the_service_and_reads_its_url(check_bundle):
    running = program.start(check_bundle, "k" * 43)
    try:
        assert running.url.startswith("http://127.0.0.1:")
        assert running.alive()
    finally:
        running.stop()
    assert not running.alive()


def test_a_program_that_fails_to_start_is_unavailable(tmp_path):
    bad = tmp_path / ("bad.cjs")
    bad.write_text("process.exit(3)")
    with pytest.raises(MastyfUnavailable):
        program.start(bad, "k" * 43, ready_timeout=15)
