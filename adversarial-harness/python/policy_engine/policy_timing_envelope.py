"""Policy evaluation timing envelope — mirrors policy-timing-envelope.ts."""

from __future__ import annotations

import os
import time


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return max(0, int(raw))
    except ValueError:
        return default


def is_policy_timing_envelope_enabled() -> bool:
    return os.environ.get("GUARDIAN_POLICY_TIMING_ENVELOPE") != "false"


def policy_min_eval_ms() -> int:
    return _env_int("MCP_GUARDIAN_POLICY_MIN_EVAL_MS", 25)


def wait_policy_timing_envelope_sync(started_at: float) -> None:
    if not is_policy_timing_envelope_enabled():
        return
    min_ms = policy_min_eval_ms()
    deadline = started_at + min_ms / 1000.0
    while time.time() < deadline:
        pass


def wait_policy_timing_envelope_async(started_at: float) -> None:
    if not is_policy_timing_envelope_enabled():
        return
    min_ms = policy_min_eval_ms()
    elapsed_ms = (time.time() - started_at) * 1000.0
    if elapsed_ms < min_ms:
        time.sleep((min_ms - elapsed_ms) / 1000.0)
