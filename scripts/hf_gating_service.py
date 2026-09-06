#!/usr/bin/env python3
"""
Mastyf Guard Hugging Face Gated Model Access Manager
Uses official huggingface_hub.HfApi to grant, verify, list, and cancel gated access.

Usage:
  python scripts/hf_gating_service.py grant --user <HF_USERNAME>
  python scripts/hf_gating_service.py cancel --user <HF_USERNAME>
  python scripts/hf_gating_service.py list-pending
  python scripts/hf_gating_service.py list-accepted
  python scripts/hf_gating_service.py status --user <HF_USERNAME>
"""

import sys
import os
import argparse
import json
from typing import Optional

try:
    from huggingface_hub import HfApi
    from huggingface_hub.utils import HfHubHTTPError
except ImportError:
    print("[!] Error: huggingface_hub is required. Install via: pip install huggingface_hub", file=sys.stderr)
    sys.exit(1)

DEFAULT_REPO = "Rudraneel93/mastyf-guard-1.5b-v2-boundary-sharpened"

def get_token() -> str:
    token = os.getenv("HF_ACCESS_TOKEN") or os.getenv("HF_TOKEN")
    if not token:
        print("[!] Error: HF_ACCESS_TOKEN or HF_TOKEN environment variable is required", file=sys.stderr)
        sys.exit(1)
    return token.strip()

def cmd_grant(args):
    api = HfApi()
    token = get_token()
    repo_id = args.repo or DEFAULT_REPO
    user = args.user.strip()

    print(f"[*] Requesting gated model access grant for @{user} on {repo_id}...")
    try:
        api.grant_access(repo_id=repo_id, user=user, token=token)
        print(f"[✓] SUCCESS: Access granted to @{user} for {repo_id}")
        if args.json:
            print(json.dumps({"success": True, "status": "granted", "user": user, "repo": repo_id}))
    except HfHubHTTPError as e:
        status_code = e.response.status_code if e.response is not None else 500
        msg = str(e)
        if status_code == 400 and ("already" in msg.lower() or "accepted" in msg.lower()):
            print(f"[✓] IDEMPOTENT: @{user} already has access to {repo_id}")
            if args.json:
                print(json.dumps({"success": True, "status": "already_granted", "user": user, "repo": repo_id}))
            return
        elif status_code == 404:
            print(f"[!] FAILED: Hugging Face user '@{user}' not found (404)", file=sys.stderr)
        elif status_code in (401, 403):
            print(f"[!] FAILED: Permission denied. HF token lacks gating administration permissions (HTTP {status_code})", file=sys.stderr)
        elif status_code == 429:
            print(f"[!] FAILED: Rate limited by Hugging Face API (429)", file=sys.stderr)
        else:
            print(f"[!] FAILED: Hugging Face API error (HTTP {status_code}): {msg}", file=sys.stderr)

        if args.json:
            print(json.dumps({"success": False, "status_code": status_code, "error": msg, "user": user}))
        sys.exit(1)
    except Exception as e:
        print(f"[!] Unexpected error: {e}", file=sys.stderr)
        sys.exit(1)

def cmd_cancel(args):
    api = HfApi()
    token = get_token()
    repo_id = args.repo or DEFAULT_REPO
    user = args.user.strip()

    print(f"[*] Cancelling/Revoking gated access for @{user} on {repo_id}...")
    try:
        api.cancel_access_request(repo_id=repo_id, user=user, token=token)
        print(f"[✓] SUCCESS: Access cancelled/revoked for @{user}")
        if args.json:
            print(json.dumps({"success": True, "status": "revoked", "user": user, "repo": repo_id}))
    except HfHubHTTPError as e:
        status_code = e.response.status_code if e.response is not None else 500
        print(f"[!] Error cancelling access (HTTP {status_code}): {e}", file=sys.stderr)
        sys.exit(1)

def cmd_list_pending(args):
    api = HfApi()
    token = get_token()
    repo_id = args.repo or DEFAULT_REPO

    try:
        pending = api.list_pending_access_requests(repo_id=repo_id, token=token)
        requests = list(pending)
        print(f"[*] Pending Access Requests for {repo_id} ({len(requests)} pending):")
        for req in requests:
            username = getattr(req, "user", str(req))
            created = getattr(req, "created_at", "")
            print(f"  - User: @{username} (Created: {created})")
        if args.json:
            print(json.dumps([{"user": getattr(r, "user", str(r))} for r in requests]))
    except Exception as e:
        print(f"[!] Error listing pending requests: {e}", file=sys.stderr)
        sys.exit(1)

def cmd_list_accepted(args):
    api = HfApi()
    token = get_token()
    repo_id = args.repo or DEFAULT_REPO

    try:
        accepted = api.list_accepted_access_requests(repo_id=repo_id, token=token)
        users = list(accepted)
        print(f"[*] Accepted Access Grants for {repo_id} ({len(users)} accepted):")
        for u in users:
            username = getattr(u, "user", str(u))
            print(f"  - User: @{username}")
        if args.json:
            print(json.dumps([{"user": getattr(u, "user", str(u))} for u in users]))
    except Exception as e:
        print(f"[!] Error listing accepted grants: {e}", file=sys.stderr)
        sys.exit(1)

def cmd_status(args):
    api = HfApi()
    token = get_token()
    repo_id = args.repo or DEFAULT_REPO
    target_user = args.user.strip().lower()

    try:
        accepted = api.list_accepted_access_requests(repo_id=repo_id, token=token)
        for u in accepted:
            username = getattr(u, "user", str(u)).lower()
            if username == target_user:
                print(f"[✓] Status for @{args.user}: ACCEPTED / GRANTED")
                if args.json:
                    print(json.dumps({"user": args.user, "status": "accepted"}))
                return

        pending = api.list_pending_access_requests(repo_id=repo_id, token=token)
        for r in pending:
            username = getattr(r, "user", str(r)).lower()
            if username == target_user:
                print(f"[?] Status for @{args.user}: PENDING")
                if args.json:
                    print(json.dumps({"user": args.user, "status": "pending"}))
                return

        print(f"[-] Status for @{args.user}: NONE (No grant or pending request found)")
        if args.json:
            print(json.dumps({"user": args.user, "status": "none"}))
    except Exception as e:
        print(f"[!] Error checking access status: {e}", file=sys.stderr)
        sys.exit(1)

def main():
    parser = argparse.ArgumentParser(description="Mastyf Guard HF Gated Access Management CLI")
    subparsers = parser.add_subparsers(dest="command", help="Available subcommands")

    # grant
    p_grant = subparsers.add_parser("grant", help="Grant gated access to user")
    p_grant.add_argument("--user", required=True, help="Hugging Face username")
    p_grant.add_argument("--repo", default=DEFAULT_REPO, help="Hugging Face repository")
    p_grant.add_argument("--json", action="store_true", help="Output JSON")

    # cancel
    p_cancel = subparsers.add_parser("cancel", help="Cancel/revoke gated access")
    p_cancel.add_argument("--user", required=True, help="Hugging Face username")
    p_cancel.add_argument("--repo", default=DEFAULT_REPO, help="Hugging Face repository")
    p_cancel.add_argument("--json", action="store_true", help="Output JSON")

    # list-pending
    p_pending = subparsers.add_parser("list-pending", help="List pending access requests")
    p_pending.add_argument("--repo", default=DEFAULT_REPO, help="Hugging Face repository")
    p_pending.add_argument("--json", action="store_true", help="Output JSON")

    # list-accepted
    p_accepted = subparsers.add_parser("list-accepted", help="List accepted access grants")
    p_accepted.add_argument("--repo", default=DEFAULT_REPO, help="Hugging Face repository")
    p_accepted.add_argument("--json", action="store_true", help="Output JSON")

    # status
    p_status = subparsers.add_parser("status", help="Check access status for a specific user")
    p_status.add_argument("--user", required=True, help="Hugging Face username")
    p_status.add_argument("--repo", default=DEFAULT_REPO, help="Hugging Face repository")
    p_status.add_argument("--json", action="store_true", help="Output JSON")

    args = parser.parse_args()

    if args.command == "grant":
        cmd_grant(args)
    elif args.command == "cancel":
        cmd_cancel(args)
    elif args.command == "list-pending":
        cmd_list_pending(args)
    elif args.command == "list-accepted":
        cmd_list_accepted(args)
    elif args.command == "status":
        cmd_status(args)
    else:
        parser.print_help()
        sys.exit(1)

if __name__ == "__main__":
    main()
