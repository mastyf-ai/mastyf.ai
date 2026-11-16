"""`mastyf-ai`: see which checks are in use, or check one call from the terminal."""

from __future__ import annotations

import argparse
import dataclasses
import json
import sys

from .client import MastyfUnavailable
from .guard import Guard


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="mastyf-ai", description="Mastyf's free checks for your agent's tools.")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status", help="which checks are in use")
    check = sub.add_parser("check", help="check one tool call (exit 2 when blocked)")
    check.add_argument("tool")
    check.add_argument("arguments", help="the call's arguments as JSON")
    args = parser.parse_args(argv)

    guard = Guard()
    try:
        if args.command == "status":
            guard.check_call("status", {})  # connects (and starts the free service if needed)
            tier = guard.tier or "unknown"
            print(f"Mastyf checks in use: {tier} tier.")
            if tier == "free":
                print("Running on this machine; nothing leaves this machine. Paid protection is the Shield app (mastyf.ai).")
            return 0
        try:
            arguments = json.loads(args.arguments)
        except json.JSONDecodeError:
            print("mastyf-ai: the arguments are not valid JSON", file=sys.stderr)
            return 1
        verdict = guard.check_call(args.tool, arguments)
        print(json.dumps({k: v for k, v in dataclasses.asdict(verdict).items() if v is not None}, indent=2))
        return 2 if verdict.blocked else 0
    except MastyfUnavailable as err:
        print(f"mastyf-ai: no check service: {err}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
