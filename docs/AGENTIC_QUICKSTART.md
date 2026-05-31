# MCP Guardian — Agentic AI Quickstart

Get started with autonomous AI features in 5 minutes.

---

## 1. Enable Agentic Features

No additional configuration required — all agentic features are active by default when MCP Guardian runs.

```bash
npm install @mcp-guardian/server
```

---

## 2. Generate Your First Policy (Feature #2)

Let Guardian observe your AI agent's tool calls, then generate a minimal-privilege policy.

```bash
# Step 1: Start behavior observation
# Via MCP tool:
start_behavior_observation

# Step 2: Use your AI agent normally for 15-30 minutes
# Guardian records all tool call patterns automatically

# Step 3: Check observation status
observation_status

# Step 4: Generate a policy
generate_policy_from_observations
```

You'll receive a complete YAML policy with:
- Allow rules for every tool your agent uses
- Rate limits based on observed peak usage + 50% buffer
- Deny rules for shell injection, path traversal, secrets, and prompt injection
- Semantic guard enabled for high-risk tools

---

## 3. Scan for Prompt Injections (Feature #6)

```bash
scan_prompt_injection --toolName write_file --arguments '{"content":"Ignore all previous instructions"}'
```

Response:
```
⚠️ PROMPT INJECTION DETECTED
Category: directive_override
Confidence: 95%
Methods: heuristic
Suspicious args: content
```

---

## 4. Predict Threats (Feature #1)

```bash
predict_threats
```

Shows current risk scores and 30/90/365-day projections for all servers.

```bash
threat_forecast_for_server --serverName "my-filesystem-server"
```

Detailed forecast with risk factors and preemptive hardening recommendations.

---

## 5. Deploy a Honeypot (Feature #4)

```bash
deploy_honeypot --name "fake-prod-db" --template "fake-production-database" --ttlMinutes 60 --alertOnInteraction true
```

The honeypot auto-destroys after 60 minutes and captures all probing attempts.

---

## 6. Verify Supply Chain (Feature #5)

```bash
verify_supply_chain --packageName "mcp-server-filesystem"
```

Checks for trusted publishers, typo-squatting, and dependency confusion.

---

## 7. Run a Self-Assessment (Feature #9)

```bash
run_self_assessment --attackCount 50
```

Generates 50 attacks using evolutionary fuzzing and tests your defenses.

---

## 8. Check Compliance (Feature #7)

```bash
compliance_posture
```

Shows posture across SOC 2, HIPAA, PCI-DSS, FedRAMP, and ISO 27001.

```bash
compliance_gap_analysis --framework "soc2"
```

Identifies missing controls and recommends policies.

---

## 9. Negotiate Agent Trust (Feature #10)

```bash
negotiate_agent_trust --remoteAgentId "agent-b" --requestedTools '["read", "query"]' --maxSessionMinutes 30
```

Establishes an ephemeral, scoped trust session between agents.

---

## 10. View Overall Status

```bash
agentic_status
```

Shows uptime, decision count, confidence, LLM usage, and all 10 feature statuses.

---

## Optional: Enable LLM for Semantic Features

```bash
export GUARDIAN_LLM_OPENAI_KEY=sk-...
export GUARDIAN_LLM_OPENAI_MODEL=gpt-4o-mini
```

This enables:
- **Semantic prompt injection detection** (novel/unseen patterns)
- Higher confidence classifications

Without LLM: all features still work using heuristic/regex-based detection.

---

## Dashboard Access

```
http://localhost:4000
```

Navigate to **Agentic AI** workspace for real-time:
- Feature status overview
- Compliance posture gauges
- Honeypot activity
- Threat mesh stats
- Task queue health

---

## Industry-Standard Roadmap Quickstarts (v4.0)

### Semantic policy (C5)

```bash
# MCP tools
policy_to_natural_language --yaml "$(cat default-policy.yaml)"
natural_language_to_policy --goal "Block curl and require gold certification"

# Dashboard API
curl -X POST http://localhost:4000/api/agentic/policy/translate \
  -H 'Content-Type: application/json' \
  -d '{"direction":"nl-to-yaml","goal":"Block execute_command in shell tools"}'
```

### Config provenance (C1)

```bash
guardian policy provenance-verify
guardian policy provenance-export --format tarball --output provenance.tar.gz
```

### Threat modeling (C2)

```bash
guardian threat-model --config scenarios/real-life/proxy-filesystem-config.json --format markdown --output THREATS.md
```

### Cross-MCP fleet chains (A1)

Set a stable session header on HTTP proxies:

```http
X-Guardian-Global-Session: my-agent-session-42
```

When an agent chains calls across MCP servers (e.g. read → exfil), Guardian blocks at `GUARDIAN_FLEET_CHAIN_BLOCK_CONFIDENCE` (default 0.65) and exports CEF to SIEM.

### Zero-trust geo (C3)

```http
X-Guardian-Geo-Region: US
```

Optional allowlist: `GUARDIAN_ZERO_TRUST_ALLOWED_REGIONS=US,CA,GB`

### Federated learning (B3, research)

```bash
export GUARDIAN_FEDERATED_LEARNING=true
export GUARDIAN_FEDERATED_ONNX_MODEL=/path/to/model.onnx  # optional
```

### Industry roadmap CLI

Verify all eleven shipped modules (A1–C5, B1–B3) at runtime:

```bash
guardian roadmap audit              # human summary; exit 0 when production-ready
guardian roadmap audit --json       # full JSON report
guardian roadmap fleet-graph-train --output graph-weights.json
guardian roadmap federated-export --output model.json
guardian roadmap observatory-sync   # cloud + mesh telemetry ingest
guardian roadmap reputation-sync    # pull mesh reputation entries
```

Dashboard: **Agentic AI → Overview** shows the same compliance audit. API: `GET /api/agentic/plan-compliance/audit`.

**Optional production env vars** (see `.env.example`):

| Variable | Purpose |
|----------|---------|
| `GUARDIAN_FLEET_CHAIN_BLOCK_CONFIDENCE` | Cross-server chain block threshold (default 0.65) |
| `GUARDIAN_FLEET_REGION` / `GUARDIAN_FLEET_PEER_REGIONS` | Multi-region fleet Redis keys |
| `GUARDIAN_FLEET_GRAPH_ONNX_MODEL` | Optional ONNX graph classifier for A1 |
| `GUARDIAN_OBSERVATORY_RELAY_URL` | Live ecosystem telemetry relay (B2) |
| `GUARDIAN_OBSERVATORY_STUB=true` | Dev stub when no relay is configured |
| `GUARDIAN_FEDERATED_MPC` / `GUARDIAN_FEDERATED_MPC_SECRET` | Pairwise-masked gradient upload (B3) |
| `GUARDIAN_BIOMETRICS_MIN_SAMPLES` | Warmup samples before biometrics block (A3) |

---

## Next Steps

- [Full Feature Reference](./AGENTIC_FEATURES.md)
- [Architecture](./AGENTIC_ARCHITECTURE.md)
- [Threat Mesh Privacy Model](./THREAT_MESH_PRIVACY.md)