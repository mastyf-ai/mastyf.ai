# Policy templates

Optional YAML fragments to merge with `default-policy.yaml` (or your own base policy).

| Template | Purpose | Enable |
|----------|---------|--------|
| [http-tools-policy.yaml](./http-tools-policy.yaml) | SSRF guards for outbound HTTP MCP tools | `GUARDIAN_HTTP_TOOLS_POLICY=true` |
| [enterprise-cost-governance.yaml](./enterprise-cost-governance.yaml) | Per-tool rate limits + token budgets | Merge via second `--policy` flag |

## Enterprise cost governance

`enterprise-cost-governance.yaml` adds:

- **Rate limits** (`maxCallsPerMinute`) — global, per expensive tool, and per-server examples. With `REDIS_URL` / Sentinel / Cluster, limits are enforced across all Guardian replicas.
- **Token budgets** (`maxTokens`) — default 32K cap plus tighter caps for batch/embedding tools.

### Daily USD budget (environment)

Policy YAML cannot express a rolling dollar cap. Set on the proxy:

```bash
export GUARDIAN_DAILY_BUDGET_USD=50
```

`CostAuditor.getDailySpendUsd()` and `isDailyBudgetExceeded()` read `call_records` since UTC midnight. Legacy alias: `MCP_GUARDIAN_COST_BUDGET`.

### Merge example

```bash
mcp-guardian proxy \
  --config mcp.json \
  --policy default-policy.yaml \
  --policy policy-templates/enterprise-cost-governance.yaml \
  --blocking-mode block
```

For Kubernetes, append the template rules to the ConfigMap policy or mount as a second file and pass both paths to the container command.
