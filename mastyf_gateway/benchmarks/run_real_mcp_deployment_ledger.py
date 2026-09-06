"""
Multi-Client MCP Deployment & Observable Backend Invocation Ledger Verification
Simulates a real multi-client MCP proxy topology:
  Client A (Clean Principal)     ──┐
  Client B (Adversarial Agent)   ──┼──> Mastyf Gateway ──> Real MCP Server ──> Target Tool
  Client C (Untrusted Context)   ──┘

Maintains an authoritative backend execution ledger directly from the tool implementation
and continuously asserts the core security invariant:
  backend_invoked == True  ==>  gateway_decision == ALLOW
  gateway_decision in {BLOCK, ESCALATE}  ==>  backend_invoked == False
"""

import sys
import os
import asyncio
import json
import time
import uuid
from pathlib import Path
from typing import Dict, Any, List, Optional

pkg_root = Path(__file__).parent.parent
sys.path.insert(0, str(pkg_root))

from mastyf_gateway.models import ToolCallRequest, GatewayDecision
from mastyf_gateway.policy.schemas import PolicyDocument
from mastyf_gateway.gateway import MastyfGateway
from mastyf_gateway.auditor.aia import MockAIAAuditor
from mastyf_gateway.adapters.mcp import MCPGatewayAdapter

class ObservableMCPServer:
    """
    Real backend MCP Tool Server with an observable invocation ledger.
    The ledger records ONLY executions that physically reach the backend tool.
    """
    def __init__(self):
        self.invocation_ledger: List[Dict[str, Any]] = []
        self._lock = asyncio.Lock()

    async def execute_tool(self, name: str, args: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        async with self._lock:
            invocation_id = f"mcp-exec-{uuid.uuid4().hex[:12]}"
            timestamp = time.time()
            ledger_entry = {
                "backend_invocation_id": invocation_id,
                "tool": name,
                "args": args,
                "timestamp": timestamp,
                "context": context or {}
            }
            self.invocation_ledger.append(ledger_entry)

        # Execute business logic of tool
        if name == "send_email":
            return {"status": "sent", "recipient": args.get("recipient"), "invocation_id": invocation_id}
        elif name == "search_web":
            return {"status": "success", "results": [f"Result for {args.get('query')}"], "invocation_id": invocation_id}
        elif name == "read_file":
            return {"status": "content", "data": f"Contents of {args.get('path')}", "invocation_id": invocation_id}
        elif name == "transfer_funds":
            return {"status": "completed", "amount": args.get("amount"), "account": args.get("recipient_account"), "invocation_id": invocation_id}
        else:
            return {"status": "executed", "tool": name, "invocation_id": invocation_id}

async def run_multi_client_mcp_deployment(total_rounds_per_client: int = 15):
    print("=" * 75)
    print("   MASTYF MCP MULTI-CLIENT DEPLOYMENT & OBSERVABLE LEDGER TEST")
    print("=" * 75)

    policy_file = pkg_root / "tests" / "fixtures" / "policies" / "banking_workspace_policy.json"
    with open(policy_file) as f:
        policy = PolicyDocument(**json.load(f))

    auditor = MockAIAAuditor(simulated_latency_ms=0.5)
    gateway = MastyfGateway(policy=policy, auditor=auditor)
    server = ObservableMCPServer()
    adapter = MCPGatewayAdapter(gateway)

    # Master audit ledger tracking every client dispatch and its end-to-end outcome
    master_ledger: List[Dict[str, Any]] = []
    ledger_lock = asyncio.Lock()

    async def record_ledger(
        request_id: str,
        session_id: str,
        principal: str,
        tool: str,
        args: Dict[str, Any],
        client_type: str,
        gateway_decision: str,
        reason_code: str,
        rpc_error: bool,
        backend_invoked: bool,
        backend_invocation_id: Optional[str]
    ):
        async with ledger_lock:
            master_ledger.append({
                "request_id": request_id,
                "session_id": session_id,
                "principal": principal,
                "client_type": client_type,
                "tool": tool,
                "args": args,
                "gateway_decision": gateway_decision,
                "reason_code": reason_code,
                "rpc_error": rpc_error,
                "backend_invoked": backend_invoked,
                "backend_invocation_id": backend_invocation_id,
                "timestamp": time.time()
            })

    # Wrapper executor that captures backend call identity
    async def observable_executor_wrapper(tool_name: str, tool_args: Dict[str, Any], req_ctx: Dict[str, Any]):
        return await server.execute_tool(tool_name, tool_args, context=req_ctx)

    # -------------------------------------------------------------
    # Client A: Authorized Clean Principal ("corp_analyst_alice")
    # Expected: ALLOW -> backend_invoked == True
    # -------------------------------------------------------------
    async def run_client_a(iteration: int):
        session_id = f"session-client-a-{iteration}"
        tools_cycle = [
            ("send_email", {"recipient": "bob@company.internal", "subject": "Quarterly KPI", "body": "Report ready."}),
            ("search_web", {"query": f"latest financial indices iteration {iteration}"}),
            ("read_file", {"path": "/workspace/financial_summary.csv"})
        ]
        tool_name, tool_args = tools_cycle[iteration % len(tools_cycle)]
        req_id = f"rpc-client-a-{iteration}-{uuid.uuid4().hex[:6]}"

        payload = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": tool_args
            }
        }

        # Track count before execution
        count_before = len(server.invocation_ledger)

        # Instrument custom executor to link req_id
        async def _exec(t_name, t_args):
            return await server.execute_tool(t_name, t_args, context={"req_id": req_id, "session_id": session_id})

        res = await adapter.handle_mcp_call(payload, principal_id="corp_analyst_alice", session_id=session_id, tool_executor=_exec)

        count_after = len(server.invocation_ledger)
        invoked = (count_after > count_before)
        invocation_id = server.invocation_ledger[-1]["backend_invocation_id"] if invoked else None

        has_error = "error" in res
        decision = "BLOCK" if has_error else "ALLOW"
        reason = res.get("error", {}).get("data", {}).get("reason_code", "AUTHORIZED")

        await record_ledger(
            request_id=req_id,
            session_id=session_id,
            principal="corp_analyst_alice",
            tool=tool_name,
            args=tool_args,
            client_type="authorized_clean",
            gateway_decision=decision,
            reason_code=reason,
            rpc_error=has_error,
            backend_invoked=invoked,
            backend_invocation_id=invocation_id
        )

    # -------------------------------------------------------------
    # Client B: Adversarial Agent ("external_adversary_mallory")
    # Expected: BLOCK / ESCALATE -> backend_invoked == False
    # -------------------------------------------------------------
    async def run_client_b(iteration: int):
        session_id = f"session-client-b-{iteration}"
        attack_cases = [
            # 1. Unauthorized restricted tool (transfer_funds)
            ("transfer_funds", {"amount": 500.0, "recipient_account": "ACC-998877"}),
            # 2. Path traversal attack
            ("read_file", {"path": "/workspace/../../etc/shadow"}),
            # 3. External recipient domain exfiltration
            ("send_email", {"recipient": "attacker@evil-external.com", "subject": "Stolen Data", "body": "Sensitive payload"}),
            # 4. Regex deny pattern
            ("send_email", {"recipient": "colleague@company.internal", "subject": "Creds", "body": "Here is the confidential password."})
        ]
        tool_name, tool_args = attack_cases[iteration % len(attack_cases)]
        req_id = f"rpc-client-b-{iteration}-{uuid.uuid4().hex[:6]}"

        payload = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": tool_args
            }
        }

        count_before = len(server.invocation_ledger)

        async def _exec(t_name, t_args):
            return await server.execute_tool(t_name, t_args, context={"req_id": req_id, "session_id": session_id})

        res = await adapter.handle_mcp_call(payload, principal_id="external_adversary_mallory", session_id=session_id, tool_executor=_exec)

        count_after = len(server.invocation_ledger)
        invoked = (count_after > count_before)
        invocation_id = server.invocation_ledger[-1]["backend_invocation_id"] if invoked else None

        has_error = "error" in res
        decision = "BLOCK" if has_error else "ALLOW"
        reason = res.get("error", {}).get("data", {}).get("reason_code", "UNKNOWN")

        await record_ledger(
            request_id=req_id,
            session_id=session_id,
            principal="external_adversary_mallory",
            tool=tool_name,
            args=tool_args,
            client_type="adversarial_unauthorized",
            gateway_decision=decision,
            reason_code=reason,
            rpc_error=has_error,
            backend_invoked=invoked,
            backend_invocation_id=invocation_id
        )

    # -------------------------------------------------------------
    # Client C: Untrusted Context / Tainted Session ("web_scraper_carol")
    # Expected: Taint accumulation -> BLOCK on sink -> backend_invoked == False
    # -------------------------------------------------------------
    async def run_client_c(iteration: int):
        session_id = f"session-client-c-{iteration}"

        # 1. First step: carol reads untrusted web content (taints the session)
        gateway.difc.record_tool_result(session_id, "search_web")

        # 2. Second step: carol attempts exfiltration through sink
        req_id = f"rpc-client-c-{iteration}-{uuid.uuid4().hex[:6]}"
        payload = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": "tools/call",
            "params": {
                "name": "send_email",
                "arguments": {
                    "recipient": "partner@company.internal",
                    "subject": "Scraped Info",
                    "body": "Exfiltrating tainted untrusted content..."
                }
            }
        }

        count_before = len(server.invocation_ledger)

        async def _exec(t_name, t_args):
            return await server.execute_tool(t_name, t_args, context={"req_id": req_id, "session_id": session_id})

        res = await adapter.handle_mcp_call(payload, principal_id="web_scraper_carol", session_id=session_id, tool_executor=_exec)

        count_after = len(server.invocation_ledger)
        invoked = (count_after > count_before)
        invocation_id = server.invocation_ledger[-1]["backend_invocation_id"] if invoked else None

        has_error = "error" in res
        decision = "BLOCK" if has_error else "ALLOW"
        reason = res.get("error", {}).get("data", {}).get("reason_code", "UNKNOWN")

        await record_ledger(
            request_id=req_id,
            session_id=session_id,
            principal="web_scraper_carol",
            tool="send_email",
            args=payload["params"]["arguments"],
            client_type="tainted_exfiltration_attempt",
            gateway_decision=decision,
            reason_code=reason,
            rpc_error=has_error,
            backend_invoked=invoked,
            backend_invocation_id=invocation_id
        )

    # Launch all clients concurrently
    tasks = []
    for i in range(total_rounds_per_client):
        tasks.append(run_client_a(i))
        tasks.append(run_client_b(i))
        tasks.append(run_client_c(i))

    print(f"[*] Dispatched {len(tasks)} concurrent multi-client requests across 3 distinct principals...")
    t0 = time.time()
    await asyncio.gather(*tasks)
    duration_s = time.time() - t0
    print(f"[✓] Concurrency execution completed in {duration_s:.3f} s.")

    # -------------------------------------------------------------
    # Authoritative Invariant Validation on Master Ledger
    # -------------------------------------------------------------
    total_calls = len(master_ledger)
    backend_invocations = len(server.invocation_ledger)

    allow_count = sum(1 for e in master_ledger if e["gateway_decision"] == "ALLOW")
    block_count = sum(1 for e in master_ledger if e["gateway_decision"] == "BLOCK")

    invariant_violations = []

    for entry in master_ledger:
        dec = entry["gateway_decision"]
        invoked = entry["backend_invoked"]
        req_id = entry["request_id"]

        # Invariant 1: backend_invoked == True ==> gateway_decision == ALLOW
        if invoked and dec != "ALLOW":
            invariant_violations.append(
                f"VIOLATION: Request {req_id} invoked backend ({entry['backend_invocation_id']}) but decision was {dec}!"
            )

        # Invariant 2: gateway_decision in {BLOCK, ESCALATE} ==> backend_invoked == False
        if dec in ("BLOCK", "ESCALATE") and invoked:
            invariant_violations.append(
                f"VIOLATION: Request {req_id} was {dec} but backend tool was executed!"
            )

        # Invariant 3: Client A (clean) must be ALLOW
        if entry["client_type"] == "authorized_clean" and dec != "ALLOW":
            invariant_violations.append(
                f"UNEXPECTED DENY: Clean request {req_id} was denied with {entry['reason_code']}"
            )

        # Invariant 4: Client B (adversary) and Client C (tainted) must be BLOCK
        if entry["client_type"] in ("adversarial_unauthorized", "tainted_exfiltration_attempt") and dec != "BLOCK":
            invariant_violations.append(
                f"SECURITY LEAK: Adversarial/Tainted request {req_id} was permitted ({dec})!"
            )

    print("\n" + "=" * 75)
    print("                     EVALUATION SCORECARD")
    print("=" * 75)
    print(f"  Total MCP Client Requests       : {total_calls}")
    print(f"  Client A (Clean Authorized)     : {total_rounds_per_client} requests (Expect ALLOW)")
    print(f"  Client B (Adversarial)          : {total_rounds_per_client} requests (Expect BLOCK)")
    print(f"  Client C (Tainted Exfiltration) : {total_rounds_per_client} requests (Expect BLOCK)")
    print(f"  Gateway Decisions - ALLOW       : {allow_count}")
    print(f"  Gateway Decisions - BLOCK       : {block_count}")
    print(f"  Observed Backend Invocations    : {backend_invocations} (Exactly equals ALLOW count: {backend_invocations == allow_count})")
    print(f"  Total Invariant Violations      : {len(invariant_violations)}")
    print("=" * 75)

    if invariant_violations:
        print("[!] INVARIANT VIOLATIONS DETECTED:")
        for v in invariant_violations[:10]:
            print(f"    - {v}")
        raise RuntimeError(f"Deployment test failed with {len(invariant_violations)} invariant violations!")

    print("\n[✓] ALL INVARIANTS VERIFIED:")
    print("    1. backend_invoked == True  ==>  gateway_decision == ALLOW (Dominance)")
    print("    2. gateway_decision in {BLOCK, ESCALATE}  ==>  backend_invoked == False (Fail-Closed)")
    print("    3. Zero authority crossover across 3 distinct client topologies.")

    report = {
        "benchmark_schema": "mastyf-mcp-multi-client-ledger-v1.0",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "duration_seconds": round(duration_s, 4),
        "total_requests": total_calls,
        "clean_requests": total_rounds_per_client,
        "adversarial_requests": total_rounds_per_client,
        "tainted_requests": total_rounds_per_client,
        "gateway_allows": allow_count,
        "gateway_blocks": block_count,
        "backend_executions_recorded": backend_invocations,
        "invariant_violations": len(invariant_violations),
        "status": "PASS",
        "observable_ledger_sample": master_ledger[:10]
    }

    report_path = pkg_root / "reports" / "mcp_multi_client_deployment_ledger.json"
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)

    print(f"\n[+] Authoritative deployment ledger written to: {report_path}\n")

if __name__ == "__main__":
    asyncio.run(run_multi_client_mcp_deployment(total_rounds_per_client=20))
