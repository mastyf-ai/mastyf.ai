# Mastyf Security Gateway v0.1.0

[![Security: Reference Monitor](https://img.shields.io/badge/Security-Reference%20Monitor-green.svg)](https://mastyf.ai)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Model Revision](https://img.shields.io/badge/V6%20Revision-d59a6aa-purple.svg)](https://huggingface.co/Rudraneel93/mastyf-guard-1.5b-v2-boundary-sharpened)
[![Acceptance: v0.1.0--RC1](https://img.shields.io/badge/Release--Candidate-v0.1.0--RC1-brightgreen.svg)](docs/v0.1.0_RC1_ACCEPTANCE_CHECKLIST.md)

> **Mastyf Security Gateway v0.1.0 is a production-pilot security gateway for AI-agent tool execution, using deterministic capability and information-flow controls with a frozen V6 neural auditor as a semantic fallback.**

---

## Architectural Overview

```text
Agent / MCP Client
        │
        ▼
┌──────────────────────────────────────────────┐
│           Mastyf Security Gateway            │
│                                              │
│  1. Request Normalization                    │
│  2. Deterministic CBAC (Capability Checks)   │
│  3. Deterministic DIFC (Session Taint Flow)  │
│  4. Active Intent Auditor (AIA V6 Fallback)  │
│  5. Formal Decision Arbiter                  │
│  6. Tamper-Evident SHA-256 Audit Telemetry   │
└──────────────────────┬───────────────────────┘
                       │
             ALLOW / BLOCK / ESCALATE
                       │
                       ▼
             Target Tool Runtime
```

### Core Security Invariants

$$\text{Authority}(\text{Final}) \subseteq \text{Authority}(\text{CBAC}) \cap \text{Authority}(\text{DIFC})$$
$$\text{Final} = \text{ALLOW} \implies \text{CBAC} = \text{ALLOW} \land \text{DIFC} = \text{ALLOW}$$

* **Authority Monotonicity**: Active Intent Auditor ($V_6$) can recommend `BLOCK`, `ALLOW`, or `ESCALATE`, but it can **never expand authority** beyond deterministic CBAC and DIFC bounds.
* **MCP Enforcement Invariant**: $\text{Decision} \in \{\text{BLOCK}, \text{ESCALATE}\} \implies \text{BackendToolInvocations} = 0$.
* **Fast-Path Target SLO**: Sub-millisecond ($<50\text{ ms}$) evaluation on deterministic routes; separate supervised deadline budgets for semantic neural auditing.
* **Estimated Amortized Audit Latency**: Under workloads where $67\%$ of attacks are caught by deterministic policies, effective audit latency is modeled at $\sim 88.4\text{ ms}$ ($\sim 3\times$ theoretical reduction in neural load relative to universal interception).

---

## Reference-Monitor Decision Matrix

| CBAC | DIFC | AIA | Final Decision | Tool Execution |
| :--- | :--- | :--- | :--- | :--- |
| `DENY` | *any* | *any (bypassed)* | `BLOCK` | ❌ No |
| *any* | `DENY` | *any (bypassed)* | `BLOCK` | ❌ No |
| `ALLOW` | `ALLOW` | `BLOCK` | `BLOCK` | ❌ No |
| `ALLOW` | `ALLOW` | `ESCALATE` | `ESCALATE` | ❌ No |
| `ALLOW` | `ALLOW` | `ALLOW` | `ALLOW` | ✅ **Yes** |
| `ALLOW` | `ALLOW` | `TIMEOUT` | `ESCALATE` | ❌ No |
| `ALLOW` | `ALLOW` | `MALFORMED` | `ESCALATE` | ❌ No |

---

## One-Command Operator Workflow

### 1. Installation
```bash
# Clone and install standalone gateway distribution
git clone https://github.com/Rudraneel93/mastyf-gateway.git
cd mastyf-gateway
pip install -e .
```

### 2. Environment Initialization & Cryptographic Model Pinning
```bash
# Initialize local folders, default policies, and config (~/.mastyf/)
mastyf init

# Cryptographically pin and register the frozen V6 reference model
mastyf model install v6

# Run comprehensive system diagnostics
mastyf doctor
```

### 3. Cryptographic Verification & Live Posture Inspection
```bash
# Verify reproducible build metadata, source Git SHA, and trusted digest chain
mastyf verify

# Inspect live component health (distinguishing Configured vs Live / Healthy)
mastyf status
```

### 4. End-to-End Canary Self-Test
```bash
# Run local 4-path canary asserting zero backend invocations on non-ALLOW
mastyf self-test
```

Output:
```text
=================================================================
       Mastyf Security Gateway End-to-End Canary Self-Test
=================================================================
Executing 4 live end-to-end paths across reference monitor & MCP proxy:

  [+] 1. Safe Call (read_balance)                      -> ALLOW    [1 backend execution] (PASS)
  [+] 2. Malicious Capability (CBAC Domain Violation)  -> BLOCK    [0 backend executions] (PASS)
  [+] 3. Tainted Exfiltration (DIFC Lattice Violation) -> BLOCK    [0 backend executions] (PASS)
  [+] 4. Ambiguous Intent (AIA Escalation)             -> ESCALATE [0 backend executions] (PASS)

-----------------------------------------------------------------
Authorization Invariant Verification:
  blocked_calls   : 0 backend executions (PASS)
  escalated_calls : 0 backend executions (PASS)
  allowed_call    : 1 backend execution  (PASS)
  total_executed  : 1 / 4 requests
-----------------------------------------------------------------
RESULT: ALL AUTHORIZATION INVARIANTS PRESERVED (SELF-TEST PASS).
```

### 5. Automated Security & Load Regression
```bash
# Execute the complete 38-test automated security invariant suite
mastyf test --security

# Run the concurrency scaling and latency saturation benchmark
mastyf test --load
```

### 6. Start the Gateway Daemon
```bash
# Start the production reference monitor and MCP proxy daemon
mastyf start --port 8787
```

---

## Release Candidate Documentation

See [v0.1.0-RC1 Acceptance Checklist](docs/v0.1.0_RC1_ACCEPTANCE_CHECKLIST.md) for full gate-by-gate verification details.
