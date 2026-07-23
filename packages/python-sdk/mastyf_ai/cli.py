#!/usr/bin/env python3
"""Mastyf AI CLI — Python entry point."""

import argparse
import json
import sys
from .client import MastyfProxy, MastyfConfig


def main():
    parser = argparse.ArgumentParser(description="Mastyf AI — MCP security proxy client")
    parser.add_argument("--proxy-url", default="http://localhost:4000", help="Proxy URL")
    parser.add_argument("--api-key", help="API key for authentication")

    sub = parser.add_subparsers(dest="command")

    health = sub.add_parser("health", help="Check proxy health")
    test = sub.add_parser("test", help="Test a tool call against policy")
    test.add_argument("tool", help="Tool name")
    test.add_argument("--args", default="{}", help="JSON arguments")
    scan = sub.add_parser("scan", help="Scan an MCP package for trust score")
    scan.add_argument("package", help="Package name")
    hooks = sub.add_parser("hooks", help="List registered hooks")
    audit = sub.add_parser("audit", help="Verify audit chain")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    proxy = MastyfProxy(MastyfConfig(proxy_url=args.proxy_url, api_key=args.api_key))

    try:
        if args.command == "health":
            print(json.dumps(proxy.health(), indent=2))
        elif args.command == "test":
            tool_args = json.loads(args.args)
            decision = proxy.test_policy(args.tool, tool_args)
            print(f"Action: {decision.action}\nRule: {decision.rule}\nReason: {decision.reason}")
        elif args.command == "scan":
            from .scanner import TrustScanner
            scanner = TrustScanner(args.proxy_url)
            result = scanner.scan(args.package)
            print(f"Package: {result.get('packageName')}")
            print(f"Score: {result.get('trustScore')}/100")
            print(f"Grade: {result.get('trustGrade')}")
            print(f"Dimensions: {json.dumps(result.get('dimensions', {}), indent=2)}")
        elif args.command == "hooks":
            for h in proxy.get_hooks():
                print(f"  {h['name']} ({h['type']}, enabled={h['enabled']})")
        elif args.command == "audit":
            chain = proxy.get_audit_chain()
            print(f"Audit entries: {chain.get('entries', 0)}")
            print(f"Integrity: {'OK' if chain.get('ok') else 'BROKEN (' + str(chain.get('breaks', 0)) + ' breaks)'}")
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        proxy.close()
