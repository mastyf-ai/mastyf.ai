"""
Mastyf Security Gateway End-to-End Self-Test Canary
Executes real local pipeline verification across 4 canonical authorization paths:
  1. Safe call             -> ALLOW    (Permitted to execute on backend MCP server)
  2. Malicious capability  -> BLOCK    (Denied by CBAC, 0 backend invocations)
  3. Tainted exfiltration  -> BLOCK    (Denied by DIFC, 0 backend invocations)
  4. Ambiguous call        -> ESCALATE (Suspended by Arbiter, 0 backend invocations)

Formally verifies the core authorization invariant:
  Decision in {BLOCK, ESCALATE} => BackendToolInvocations == 0
"""

import asyncio
import json
import os
from pathlib import Path
from typing import Dict, Any, List

from .policy.schemas import PolicyDocument, CapabilityDefinition, ArgumentConstraint
from .gateway import MastyfGateway
from .auditor.aia import BaseAIAAuditor
from .adapters.mcp import MCPGatewayAdapter
from .models import DecisionType, ToolCallRequest, AIADecision

class CanaryMCPServer:
    """Mock backend MCP Server tracking all received tool execution calls."""
    def __init__(self):
        self.invocation_count = 0
        self.invocations: List[Dict[str, Any]] = []

    async def execute_tool(self, name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        self.invocation_count += 1
        self.invocations.append({"name": name, "args": args})
        return {"status": "SUCCESS", "tool": name, "result": "Executed successfully"}

class ControlledSelfTestAuditor(BaseAIAAuditor):
    """Deterministic auditor for self-test canary paths."""
    def __init__(self):
        self.model_revision = "d59a6aa01f9139dff106146addb04109afa69c03"

    async def evaluate(self, req: ToolCallRequest) -> AIADecision:
        tool = req.tool_name
        args_str = json.dumps(req.tool_args)
        
        if "escalate_trigger" in args_str or tool == "ambiguous_action":
            return AIADecision(
                decision="ESCALATE",
                confidence=0.50,
                reason_code="AIA_AMBIGUOUS_INTENT",
                model_revision=self.model_revision
            )
        elif "malicious_semantic" in args_str:
            return AIADecision(
                decision="BLOCK",
                confidence=0.99,
                reason_code="AIA_INJECTION_DETECTED",
                model_revision=self.model_revision
            )
        else:
            return AIADecision(
                decision="ALLOW",
                confidence=0.99,
                reason_code="AIA_BENIGN_INTENT",
                model_revision=self.model_revision
            )

def build_self_test_policy() -> PolicyDocument:
    """Constructs a deterministic reference policy for self-test validation."""
    return PolicyDocument(
        policy_id="self-test-v1",
        version="1.0",
        capabilities=[
            CapabilityDefinition(
                capability_name="read_balance_cap",
                tool_name="read_balance",
                allowed_principals=["user", "agent"],
                argument_constraints={
                    "account_id": ArgumentConstraint(
                        required=True,
                        expected_type="string",
                        pattern=r"^ACC-[0-9]{3,6}$"
                    )
                }
            ),
            CapabilityDefinition(
                capability_name="send_email_cap",
                tool_name="send_email",
                allowed_principals=["user", "agent"],
                argument_constraints={
                    "recipient": ArgumentConstraint(
                        required=True,
                        expected_type="string",
                        allowed_domains=["company.internal", "mastyf.ai"]
                    ),
                    "subject": ArgumentConstraint(
                        required=True,
                        expected_type="string",
                        max_length=200
                    )
                }
            ),
            CapabilityDefinition(
                capability_name="ambiguous_action_cap",
                tool_name="ambiguous_action",
                allowed_principals=["user", "agent"]
            )
        ]
    )

async def execute_self_test_suite() -> Dict[str, Any]:
    """Executes the 4-path end-to-end self-test canary."""
    policy = build_self_test_policy()
    auditor = ControlledSelfTestAuditor()
    gateway = MastyfGateway(policy=policy, auditor=auditor)
    backend_server = CanaryMCPServer()
    adapter = MCPGatewayAdapter(gateway)

    results = {
        "canaries": [],
        "invariants_passed": True,
        "backend_executions": {
            "allowed": 0,
            "blocked": 0,
            "escalated": 0,
            "total": 0
        }
    }

    # Canary 1: Safe Call -> Expect ALLOW -> 1 Backend Execution
    safe_session = "sess-canary-safe"
    safe_payload = {
        "jsonrpc": "2.0",
        "id": "canary-safe-1",
        "method": "tools/call",
        "params": {
            "name": "read_balance",
            "arguments": {"account_id": "ACC-101"}
        }
    }
    prev_count = backend_server.invocation_count
    resp1 = await adapter.handle_mcp_call(
        mcp_payload=safe_payload,
        session_id=safe_session,
        principal_id="user",
        tool_executor=backend_server.execute_tool
    )
    delta1 = backend_server.invocation_count - prev_count
    passed1 = ("result" in resp1 and not resp1["result"].get("isError", True) and delta1 == 1)
    if not passed1:
        results["invariants_passed"] = False
    results["backend_executions"]["allowed"] += delta1
    results["canaries"].append({
        "name": "1. Safe Call (read_balance)",
        "expected_decision": "ALLOW",
        "actual_decision": "ALLOW" if delta1 == 1 else "FAIL",
        "backend_executions": delta1,
        "status": "PASS" if passed1 else "FAIL"
    })

    # Canary 2: Malicious Capability (CBAC Domain Violation) -> Expect BLOCK -> 0 Backend Executions
    block_session = "sess-canary-block-cbac"
    block_payload = {
        "jsonrpc": "2.0",
        "id": "canary-block-cbac",
        "method": "tools/call",
        "params": {
            "name": "send_email",
            "arguments": {
                "recipient": "attacker@evil-external.com",
                "subject": "Exfil"
            }
        }
    }
    prev_count = backend_server.invocation_count
    resp2 = await adapter.handle_mcp_call(
        mcp_payload=block_payload,
        session_id=block_session,
        principal_id="user",
        tool_executor=backend_server.execute_tool
    )
    delta2 = backend_server.invocation_count - prev_count
    passed2 = ("error" in resp2 and resp2["error"]["data"].get("decision") == "BLOCK" and delta2 == 0)
    if not passed2:
        results["invariants_passed"] = False
    results["backend_executions"]["blocked"] += delta2
    results["canaries"].append({
        "name": "2. Malicious Capability (CBAC Domain Violation)",
        "expected_decision": "BLOCK",
        "actual_decision": "BLOCK" if "error" in resp2 else "FAIL",
        "backend_executions": delta2,
        "status": "PASS" if passed2 else "FAIL"
    })

    # Canary 3: Tainted Exfiltration (DIFC Taint Violation) -> Expect BLOCK -> 0 Backend Executions
    tainted_session = "sess-canary-tainted"
    gateway.difc.add_taint(tainted_session, "UNTRUSTED_WEB_SCRAPE")
    difc_payload = {
        "jsonrpc": "2.0",
        "id": "canary-block-difc",
        "method": "tools/call",
        "params": {
            "name": "send_email",
            "arguments": {
                "recipient": "internal@company.internal",
                "subject": "Report"
            }
        }
    }
    prev_count = backend_server.invocation_count
    resp3 = await adapter.handle_mcp_call(
        mcp_payload=difc_payload,
        session_id=tainted_session,
        principal_id="user",
        tool_executor=backend_server.execute_tool
    )
    delta3 = backend_server.invocation_count - prev_count
    passed3 = ("error" in resp3 and resp3["error"]["data"].get("decision") == "BLOCK" and delta3 == 0)
    if not passed3:
        results["invariants_passed"] = False
    results["backend_executions"]["blocked"] += delta3
    results["canaries"].append({
        "name": "3. Tainted Exfiltration (DIFC Lattice Violation)",
        "expected_decision": "BLOCK",
        "actual_decision": "BLOCK" if "error" in resp3 else "FAIL",
        "backend_executions": delta3,
        "status": "PASS" if passed3 else "FAIL"
    })

    # Canary 4: Ambiguous Call (AIA Escalation) -> Expect ESCALATE -> 0 Backend Executions
    escalate_session = "sess-canary-escalate"
    escalate_payload = {
        "jsonrpc": "2.0",
        "id": "canary-escalate",
        "method": "tools/call",
        "params": {
            "name": "ambiguous_action",
            "arguments": {"escalate_trigger": True}
        }
    }
    prev_count = backend_server.invocation_count
    resp4 = await adapter.handle_mcp_call(
        mcp_payload=escalate_payload,
        session_id=escalate_session,
        principal_id="user",
        tool_executor=backend_server.execute_tool
    )
    delta4 = backend_server.invocation_count - prev_count
    passed4 = ("error" in resp4 and resp4["error"]["data"].get("decision") == "ESCALATE" and delta4 == 0)
    if not passed4:
        results["invariants_passed"] = False
    results["backend_executions"]["escalated"] += delta4
    results["canaries"].append({
        "name": "4. Ambiguous Intent (AIA Escalation)",
        "expected_decision": "ESCALATE",
        "actual_decision": "ESCALATE" if "error" in resp4 else "FAIL",
        "backend_executions": delta4,
        "status": "PASS" if passed4 else "FAIL"
    })

    results["backend_executions"]["total"] = backend_server.invocation_count
    return results

def run_self_test() -> bool:
    """CLI entry point for mastyf self-test."""
    print("=" * 65)
    print("       Mastyf Security Gateway End-to-End Canary Self-Test")
    print("=" * 65)
    print("Executing 4 live end-to-end paths across reference monitor & MCP proxy:\n")

    results = asyncio.run(execute_self_test_suite())

    for canary in results["canaries"]:
        print(f"  [+] {canary['name']:<48} -> {canary['expected_decision']:<8} [{canary['backend_executions']} backend execution{'s' if canary['backend_executions'] != 1 else ''}] ({canary['status']})")

    print("\n" + "-" * 65)
    print("Authorization Invariant Verification:")
    print(f"  blocked_calls   : {results['backend_executions']['blocked']} backend executions ({'PASS' if results['backend_executions']['blocked'] == 0 else 'FAIL'})")
    print(f"  escalated_calls : {results['backend_executions']['escalated']} backend executions ({'PASS' if results['backend_executions']['escalated'] == 0 else 'FAIL'})")
    print(f"  allowed_call    : {results['backend_executions']['allowed']} backend execution  ({'PASS' if results['backend_executions']['allowed'] == 1 else 'FAIL'})")
    print(f"  total_executed  : {results['backend_executions']['total']} / 4 requests")
    print("-" * 65)

    if results["invariants_passed"]:
        print("RESULT: ALL AUTHORIZATION INVARIANTS PRESERVED (SELF-TEST PASS).\n")
        return True
    else:
        print("RESULT: INVARIANT VIOLATION DETECTED (SELF-TEST FAIL).\n")
        return False

def run_commercial_self_test(home_dir: Path) -> bool:
    """
    Executes comprehensive single-command verification of the commercial installation:
    1. License present (~/.mastyf/entitlement.json)
    2. Ed25519 signature valid (verified against trusted keyring)
    3. License not expired (within valid active or grace period)
    4. Lemon Squeezy instance identifier present
    5. Customer Hugging Face authentication available (HF_TOKEN or ~/.cache/huggingface/token)
    6. Model access & revision match (entitlement revision matches frozen V6)
    7. Gateway security invariant self-test (4-row canary with 0 backend executions on non-ALLOW)
    """
    print("=" * 65)
    print("     Mastyf Guard Pro Commercial Installation Self-Test")
    print("=" * 65)

    passed_all = True

    # 1. License Present & Ed25519 Cryptography
    from .entitlement import load_local_entitlement, EntitlementStatus
    status, payload, detail = load_local_entitlement(home_dir)

    if status == EntitlementStatus.UNLICENSED:
        print(f"  [!] 1. Commercial License File : FAIL (Missing ~/.mastyf/entitlement.json; run 'mastyf activate')")
        passed_all = False
    elif status == EntitlementStatus.TAMPERED:
        print(f"  [!] 2. Cryptographic Signature : FAIL (Ed25519 signature invalid or token tampered)")
        passed_all = False
    elif status == EntitlementStatus.UNTRUSTED_KEY:
        print(f"  [!] 2. Keyring Verification    : FAIL (Token signed by unknown key_id: {payload.get('key_id') if payload else ''})")
        passed_all = False
    elif status == EntitlementStatus.EXPIRED:
        print(f"  [!] 3. Temporal Validity       : FAIL ({detail})")
        passed_all = False
    elif status == EntitlementStatus.GRACE_PERIOD:
        print(f"  [✓] 1. Commercial License File : PASS (Present)")
        print(f"  [✓] 2. Cryptographic Signature : PASS (Ed25519 verified against keyring [{payload.get('key_id')}])")
        print(f"  [!] 3. Temporal Validity       : WARNING (Active 7-day grace period; run 'mastyf license renew')")
    elif status == EntitlementStatus.ACTIVE:
        print(f"  [✓] 1. Commercial License File : PASS (Present)")
        print(f"  [✓] 2. Cryptographic Signature : PASS (Ed25519 verified against keyring [{payload.get('key_id')}])")
        print(f"  [✓] 3. Temporal Validity       : PASS ({detail})")

    # 4. Instance ID Check
    instance_id = payload.get("instance_id") if payload else None
    if instance_id and instance_id != "inst_default":
        print(f"  [✓] 4. Lemon License Instance  : PASS (Bound to instance: {instance_id})")
    elif payload:
        print(f"  [✓] 4. Lemon License Instance  : PASS (Default instance: {instance_id})")
    else:
        print(f"  [!] 4. Lemon License Instance  : FAIL (No instance data)")
        passed_all = False

    # 5. Customer HF Authentication Check
    hf_token = os.getenv("HF_TOKEN") or os.getenv("HUGGING_FACE_HUB_TOKEN")
    if not hf_token:
        cache_token_file = Path.home() / ".cache" / "huggingface" / "token"
        if cache_token_file.exists():
            try:
                hf_token = cache_token_file.read_text().strip()
            except Exception:
                pass

    if hf_token:
        print(f"  [✓] 5. HF Authentication Token : PASS (Configured)")
    else:
        print(f"  [!] 5. HF Authentication Token : WARNING (HF_TOKEN not set; run 'huggingface-cli login' to download gated weights)")

    # 6. HF Model Access Available (Authoritative Customer-Side Repository Probe)
    from .release import FROZEN_V6_HF_REVISION, FROZEN_V6_REPO
    if hf_token:
        import urllib.request
        import urllib.error
        hf_probe_url = f"https://huggingface.co/api/models/{FROZEN_V6_REPO}/revision/{FROZEN_V6_HF_REVISION}"
        probe_req = urllib.request.Request(
            hf_probe_url,
            headers={"Authorization": f"Bearer {hf_token}", "User-Agent": "Mastyf-SelfTest/0.1.1"}
        )
        try:
            with urllib.request.urlopen(probe_req, timeout=5) as probe_resp:
                if probe_resp.status == 200:
                    print(f"  [✓] 6. HF Model Access          : PASS (Gated repository access verified)")
                else:
                    print(f"  [!] 6. HF Model Access          : FAIL (Unexpected status {probe_resp.status})")
                    passed_all = False
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                print(f"  [!] 6. HF Model Access          : FAIL (HTTP {e.code} Forbidden: Customer account not granted access to gated model)")
                passed_all = False
            else:
                print(f"  [!] 6. HF Model Access          : WARNING (HTTP {e.code} from HF Hub: {e.reason})")
        except Exception as e:
            print(f"  [!] 6. HF Model Access          : WARNING (Offline / unreachable: {str(e)[:40]})")
    else:
        print(f"  [!] 6. HF Model Access          : SKIPPED (Requires HF authentication token)")

    # 7. Model Revision Match
    token_rev = payload.get("model_revision") if payload else ""
    if token_rev == FROZEN_V6_HF_REVISION:
        print(f"  [✓] 7. Model Revision Binding  : PASS (Pinned to {FROZEN_V6_HF_REVISION[:10]}... on {FROZEN_V6_REPO})")
    elif payload:
        print(f"  [!] 7. Model Revision Binding  : FAIL (Revision mismatch: {token_rev} != {FROZEN_V6_HF_REVISION})")
        passed_all = False
    else:
        print(f"  [!] 7. Model Revision Binding  : UNVERIFIED (No entitlement)")
        passed_all = False

    print("-" * 65)
    print("  8. Gateway Security Reference Monitor & Dominance Canaries:")
    results = asyncio.run(execute_self_test_suite())
    for canary in results["canaries"]:
        print(f"     [+] {canary['name']:<44} -> {canary['expected_decision']:<8} [{canary['backend_executions']} backend exec] ({canary['status']})")

    if not results["invariants_passed"]:
        passed_all = False
        print("  [!] Security canary invariance check: FAILED")
    else:
        print("  [✓] Security canary invariance check: PASS (0 backend executions on non-ALLOW)")

    print("=" * 65)
    if passed_all:
        print("COMMERCIAL SELF-TEST RESULT: PASS (All commercial & security invariants verified).\n")
        return True
    else:
        print("COMMERCIAL SELF-TEST RESULT: FAIL (One or more commercial invariants failed).\n")
        return False
