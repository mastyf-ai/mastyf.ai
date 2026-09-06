from __future__ import annotations

from pathlib import Path
from .loader import PolicyError, compile_policy, validate_policy

STARTER_POLICY = '''id: customer-support-agent
version: "1.0"
description: "Starter policy for a capability-mediated agent"

capabilities:
  - tool: customer.lookup
    actions: [read]
    allowed_principals: ["agent", "supervisor"]
    constraints:
      customer_id:
        type: string
        pattern: "^CUST-[0-9]{4,8}$"

  - tool: ticket.update
    actions: [write]
    allowed_principals: ["agent"]
    constraints:
      ticket_id:
        type: string
      status:
        type: string
        allowed_values: ["open", "pending", "resolved"]

  - tool: read_balance
    actions: [read]
    allowed_principals: ["agent"]
    constraints:
      account_id:
        type: string
        pattern: "^ACC-[0-9]{3,6}$"

information_flow:
  taints:
    - tag: CONFIDENTIAL_PII
      sources: ["customer.lookup", "read_customer_records"]
      denied_sinks: [external_webhook, public_slack, raw_export]
    - tag: FINANCIAL_DATA
      sources: [read_balance]
      denied_sinks: [external_webhook]

rules:
  deny_privilege_escalation: true
  fail_closed: true
  require_audit_for:
    - refund_payment
    - financial.write
'''


def cmd_policy_init(output: str = "mastyf-policy.yaml", force: bool = False) -> int:
    path = Path(output)
    if path.exists() and not force:
        raise PolicyError(f"refusing to overwrite existing file: {path} (use --force)")
    path.write_text(STARTER_POLICY, encoding="utf-8")
    print(f"Created policy: {path}")
    return 0


def cmd_policy_validate(path: str) -> int:
    policy = validate_policy(path)
    compiled = compile_policy(policy)
    print(f"Policy:        {policy.id}")
    print(f"Version:       {policy.version}")
    print(f"Capabilities:  {len(policy.capabilities)}")
    print(f"CBAC rules:    {sum(len(c.actions) for c in policy.capabilities)} tool/action pairs")
    print(f"Taint tags:    {len(policy.information_flow.taints)}")
    print(f"Audit rules:   {len(policy.rules.require_audit_for)}")
    print(f"Fail closed:   {policy.rules.fail_closed}")
    print("Validation:    PASS")
    # Touch all compiled sections to guarantee compilation completed.
    _ = (compiled.cbac, compiled.difc, compiled.rules)
    return 0
