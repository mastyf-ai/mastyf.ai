"""Per-session multi-call read-then-exfil chain detection."""

from __future__ import annotations

import re
import time
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Optional

from .path_guard import evaluate_path_guard, extract_path_argument_values
from .types import CallContext, PolicyDecision

FLOW_WINDOW_MS = 5 * 60 * 1000
MAX_HISTORY = 24

SENSITIVE_READ_TOOLS = frozenset(
    {
        "read_file",
        "read_text_file",
        "read",
        "get_file_contents",
        "cat",
        "head",
        "tail",
    }
)

EXFIL_TOOL_NAMES = frozenset({"http_request", "post_webhook", "send_message", "notify", "upload"})
NON_EXFIL_TOOLS = SENSITIVE_READ_TOOLS | frozenset(
    {
        "puppeteer_navigate",
        "puppeteer_screenshot",
        "search",
        "search_files",
        "query",
        "list_directory",
        "echo",
    }
)
EXFIL_HINT = re.compile(
    r"\b(?:webhook|callback|post|upload|send|forward|notify|http_request|fetch_url)\b",
    re.I,
)


@dataclass
class FlowEvent:
    tool_name: str
    sensitive_read: bool
    at: float


_history: dict[str, list[FlowEvent]] = defaultdict(list)


def flow_session_key(ctx: CallContext) -> str:
    tenant = ctx.tenant_id or "default"
    sub = "anon"
    if ctx.agent_identity:
        sub = ctx.agent_identity.client_id or ctx.agent_identity.sub or "anon"
    return f"{tenant}:{ctx.server_name}:{sub}"


def _args_sensitive(args: dict[str, Any] | None) -> bool:
    if not args:
        return False
    paths = extract_path_argument_values(args)
    if paths and evaluate_path_guard(paths).block:
        return True
    blob = " ".join(str(v) for v in args.values())
    return bool(
        re.search(
            r"\b(?:/etc/passwd|\.env|\.ssh/|id_rsa|credentials|serviceaccount/token|/proc/)",
            blob,
            re.I,
        )
    )


def _is_exfil_tool(tool_name: str, args: dict[str, Any] | None) -> bool:
    lower = tool_name.lower()
    if lower in NON_EXFIL_TOOLS:
        return False
    if lower in EXFIL_TOOL_NAMES or EXFIL_HINT.search(lower):
        return True
    if not args:
        return False
    import json

    blob = json.dumps(args, ensure_ascii=False)
    return bool(EXFIL_HINT.search(blob))


def record_session_tool_call(ctx: CallContext) -> None:
    key = flow_session_key(ctx)
    now = time.time() * 1000
    sensitive = ctx.tool_name in SENSITIVE_READ_TOOLS and _args_sensitive(ctx.arguments)
    hist = _history[key]
    hist.append(FlowEvent(ctx.tool_name, sensitive, now))
    if len(hist) > MAX_HISTORY:
        del hist[: len(hist) - MAX_HISTORY]


def reset_session_flow_history() -> None:
    _history.clear()


def evaluate_session_flow_guard(ctx: CallContext) -> Optional[PolicyDecision]:
    if not _is_exfil_tool(ctx.tool_name, ctx.arguments):
        return None
    key = flow_session_key(ctx)
    now = time.time() * 1000
    hist = [e for e in _history.get(key, []) if now - e.at <= FLOW_WINDOW_MS]
    prior = next((e for e in hist if e.sensitive_read), None)
    if not prior:
        return None
    return PolicyDecision(
        "block",
        "session-flow-exfil-chain",
        f"Multi-call exfil chain: sensitive read via '{prior.tool_name}' then '{ctx.tool_name}'",
    )
