# MCP Guardian — Agentic AI Features (v4.0.0)

MCP Guardian includes **10 core autonomous agentic features** plus the **industry-standard roadmap (11 features)** for fleet-wide MCP protection.

> **Industry-standard roadmap (shipped v4.0):** See [AGENTIC_ROADMAP.md](./AGENTIC_ROADMAP.md) for A1–C5 and B1–B3 (cross-MCP chains, digital twin, biometrics, reputation mesh, observatory, federated learning, provenance, threat modeling, zero-trust, insurance, semantic policy).

| Tier | Features | Key APIs / CLI |
|------|----------|----------------|
| Paradigm | A1 chains, A2 twin, A3 biometrics | `GET /api/agentic/fleet-chains`, `POST /api/agentic/digital-twin/replay` |
| Ecosystem | B1 reputation, B2 observatory, B3 federated | `POST /api/agentic/reputation/query`, `GET /api/agentic/federated/status`, `guardian roadmap observatory-sync` |
| Enterprise | C1 provenance, C2 threat model, C3 zero-trust, C4 insurance, C5 semantic policy | `guardian threat-model`, `POST /api/agentic/policy/translate`, `GET /api/provenance/timeline` |
| **Compliance** | Runtime audit (all 11 modules) | `guardian roadmap audit`, `GET /api/agentic/plan-compliance/audit`, dashboard **Agentic AI → Overview** |

---

## Overview

| # | Feature | Phase | MCP Tools |
|---|---------|-------|-----------|
| 1 | **Predictive Threat Anticipation** | P1 | `predict_threats`, `threat_forecast_for_server`, `preemptive_recommendations` |
| 2 | **Autonomous Policy Generation** | P0 | `start_behavior_observation`, `stop_behavior_observation`, `generate_policy_from_observations`, `suggest_policy_improvements`, `observation_status` |
| 3 | **Cross-Deployment Threat Intel Mesh** | P3 | `contribute_threat_signature`, `threat_intel_status` |
| 4 | **Agentic Honeypot Deployer** | P3 | `deploy_honeypot`, `honeypot_report`, `destroy_honeypot`, `list_honeypots` |
| 5 | **Supply Chain Integrity Verification** | P1 | `verify_supply_chain`, `supply_chain_status`, `sbom_export` |
| 6 | **Prompt Injection Detection (MCP Layer)** | P0 | `scan_prompt_injection`, `prompt_injection_report` |
| 7 | **Autonomous Compliance Evidence** | P2 | `generate_compliance_evidence`, `compliance_gap_analysis`, `compliance_posture`, `list_compliance_frameworks` |
| 8 | **Agentic Drift Detection & Rollback** | P1 | `detect_drift`, `capture_baseline`, `rollback_server_config`, `drift_history` |
| 9 | **Autonomous Red Team Engine** | P2 | `run_self_assessment`, `schedule_red_team`, `red_team_results`, `ab_test_policy` |
| 10 | **Agent-to-Agent Trust Protocol** | P3 | `negotiate_agent_trust`, `agent_trust_status`, `revoke_agent_trust`, `trust_registry_list` |

Plus: `agentic_status` — overall status of all features.

---

## Feature Details

### 1. Predictive Threat Anticipation
Predicts which MCP servers will be targeted *before* an attack happens.

**Risk factors:**
- CVE exposure (CVSS scores × exploit maturity)
- Tool capability risk (filesystem write > read-only APIs)
- Network exposure (stdio local-only vs. HTTP/SSE remote)
- Release velocity
- Authentication posture

**Output:** 30/90/365-day risk projections, preemptive hardening recommendations, exploitation probability.

### 2. Autonomous Policy Generation
Observes AI agent behavior and generates minimal-privilege YAML policies.

**Workflow:**
1. `start_behavior_observation` → begins recording tool call patterns
2. Guardian observes argument schemas, call frequency, co-occurrences
3. `generate_policy_from_observations` → produces ready-to-apply YAML
4. `suggest_policy_improvements` → diffs against existing policy

### 3. Cross-Deployment Threat Intel Mesh
Privacy-preserving threat intelligence sharing across deployments.

- **Differential privacy** (ε-configurable)
- **Signature hashing** — raw payloads never leave the deployment
- **Threshold gating** — patterns must be seen N times before sharing
- **Opt-in** — `GUARDIAN_THREAT_MESH_ENABLED=true`

### 4. Agentic Honeypot Deployer
Deploys ephemeral decoy MCP servers to detect adversarial probing.

**Templates:** fake database, filesystem, GitHub, Slack, API server, credentials vault, admin panel.

**Features:** Auto-destroy after TTL, attack pattern detection, captured call analysis.

### 5. Supply Chain Integrity Verification
Beyond CVE scanning — verifies the full dependency chain.

- **Trusted publisher verification** (npm/PyPI signatures)
- **Dependency confusion detection** (namespace conflicts)
- **Typo-squat detection** (Levenshtein distance against 24+ known MCP packages)
- **SBOM export** (CycloneDX/SPDX formats)

### 6. Prompt Injection Detection (MCP Layer)
Scans tool call arguments for prompt injection payloads targeting downstream AI agents.

**Two-stage pipeline:**
1. **Heuristic** — 50+ curated regex patterns across 8 categories
2. **Semantic** — LLM-based classifier for novel patterns (optional, requires LLM config)

**Categories detected:** directive override, role confusion, hidden instruction, payload concealment, data exfiltration, multi-language injection, token theft, context manipulation.

### 7. Autonomous Compliance Evidence
Maps active policies and blocked incidents to compliance frameworks.

**Supported frameworks:** SOC 2, HIPAA, PCI-DSS v4.0, FedRAMP (Moderate), ISO/IEC 27001:2022.

**Output:** Posture scores, gap analysis, recommended policies, auditor-ready evidence bundles.

### 8. Agentic Drift Detection & Rollback
Monitors MCP server behavior for anomalies indicating compromise or silent updates.

**Detects:** Schema changes, performance degradation (latency, success rate), response shape changes, new/removed tools.

**Response:** Recommend rollback with one-click restoration to known-good baseline.

### 9. Autonomous Red Team Engine
Self-assesses defenses using evolutionary fuzzing.

- **16 curated base attacks** (shell injection, path traversal, prompt injection, secret exposure, unicode evasion)
- **Mutation engine** — 6 mutation strategies (case obfuscation, space substitution, null bytes, URL encoding, unicode homoglyphs)
- **Combination engine** — generates hybrid attacks
- **A/B policy testing** — test proposed policy changes against attack corpus

### 10. Agent-to-Agent Trust Protocol
Automated trust negotiation between AI agents behind separate Guardian instances.

**4-stage protocol:**
1. Capability exchange with attestation
2. Policy negotiation (least-privilege)
3. Ephemeral session establishment with auto-expiry
4. Full audit logging

---

## Configuration

### LLM Configuration (for semantic features)

```bash
# OpenAI
GUARDIAN_LLM_OPENAI_KEY=sk-...
GUARDIAN_LLM_OPENAI_MODEL=gpt-4o-mini

# Anthropic
GUARDIAN_LLM_ANTHROPIC_KEY=sk-ant-...
GUARDIAN_LLM_ANTHROPIC_MODEL=claude-3-5-haiku-latest

# Open-compatible (Ollama, LM Studio)
GUARDIAN_LLM_COMPATIBLE_KEY=ollama
GUARDIAN_LLM_COMPATIBLE_BASE_URL=http://localhost:11434/v1
GUARDIAN_LLM_COMPATIBLE_MODEL=llama3

# Common
GUARDIAN_LLM_TIMEOUT_MS=15000
```

### Threat Mesh

```bash
GUARDIAN_THREAT_MESH_ENABLED=true
GUARDIAN_THREAT_MESH_RELAY_URL=https://mesh.mcp-guardian.cloud
GUARDIAN_THREAT_MESH_MIN_REPORTS=3
GUARDIAN_THREAT_MESH_EPSILON=1.0
```

---

## Proxy Integration

Add these hooks in `proxy-server.ts` at `tools/call` processing time:

```typescript
import { hookAgenticObservation, hookPromptInjectionCheck, hookThreatMeshContribution } from '../agentic/proxy-integration.js';

// After policy evaluation, before forwarding
await hookAgenticObservation(container, serverName, toolName, args, sessionHash, requestLatency, success);

// Before forwarding — block/cleanse prompt injections
const injectionCheck = await hookPromptInjectionCheck(container, serverName, toolName, args);
if (injectionCheck.blocked) {
  return blockResponse(injectionCheck.reason);
}
if (injectionCheck.sanitizedArgs) {
  args = injectionCheck.sanitizedArgs;
}
```

---

## Architecture

```
src/agentic/
├── core.ts                          # AgenticResult, AgenticPipeline, ApprovalGate
├── scheduler.ts                     # Autonomous cron scheduler
├── model-provider.ts                # Unified LLM interface (OpenAI/Anthropic/Compatible)
├── task-queue.ts                    # Priority task queue with dedup
├── telemetry.ts                     # Decision audit, metrics, LLM cost tracking
├── proxy-integration.ts             # Proxy pipeline hooks
├── policy-gen/                      # Feature #2 (4 files)
├── prompt-injection/                # Feature #6 (3 files)
├── threat-prediction/               # Feature #1 (2 files)
├── supply-chain/                    # Feature #5 (1 file)
├── drift/                           # Feature #8 (1 file)
├── compliance/                      # Feature #7 (1 file)
├── red-team/                        # Feature #9 (1 file)
├── threat-mesh/                     # Feature #3 (1 file)
├── honeypot/                        # Feature #4 (1 file)
└── trust-negotiation/               # Feature #10 (1 file)
```

**Total:** 24 source files, 35 MCP tools, 10 features, ~7,000+ lines of code.

---

## Enterprise dashboard (Agentic AI workspace)

The dashboard **Agentic AI** workspace (`?workspace=agentic`) is a production-oriented control plane with seven sub-views:

| View | Data sources |
|------|----------------|
| **Overview** | `GET /api/agentic/dashboard` — KPIs, traffic area chart, decisions-by-feature bar chart |
| **Trust & Servers** | Server registry + live `GuardianScore` per server |
| **Threats & Defense** | Injection stats, threat mesh, honeypots |
| **Policy & Compliance** | Behavior observation + framework `postureScore` |
| **Operations** | Task queue, approval gate, scheduler status |
| **Audit & Decisions** | `GET /api/agentic/audit`, `GET /api/agentic/decisions` (10s poll) |
| **Admin Tools** | On-demand POST actions with inline results (no sidebar JSON dump) |

Proxy traffic feeds agentic telemetry when `GUARDIAN_AGENTIC_ENABLED` is not `false` and the agentic container is initialized at startup.

---

## Compatibility

- **MCP SDK:** 1.25+
- **Node.js:** 18+
- **LLMs:** OpenAI, Anthropic Claude, Ollama, LM Studio, any OpenAI-compatible API
- **Database:** SQLite (default) or PostgreSQL
- **License:** MIT (Community) / Pro (Enterprise features)