# Mastyf Security Gateway v0.1.1-rc1 & v0.1.0-rc1
## Third-Party Security Assessment Dossier

---

### Executive Notice to Assessors

> **Document Status:** Formally Frozen Dual-Candidate Assessment Dossier  
> **Target Release Candidate:** `mastyf-gateway v0.1.1-rc1` (Hardened Remediated Candidate)  
> **Forensic Baseline Reference:** `mastyf-gateway v0.1.0-rc1` (Frozen Immutable Forensic Baseline)  
> **Product Classification:** Production-Pilot Release Candidate, internally security-validated, container-hardened, and live dominance-probed; independent security assessment pending.  
> **Assessment Scope Target:** Complete Reference-Monitor Mediation, Invariant Dominance, Session Authority Isolation, and Container Supply-Chain Hardening.  
> **Container Vulnerability Gate:** **PASS subject to documented residual-risk dispositions — 0 Critical, 0 High, 29 Medium, 4 Low.**

---

## 1. Primary Assessment Objective & Evaluator Mandate

Assessors are requested to evaluate the Mastyf Security Gateway against this primary technical question:

> **"Can any request path cause backend tool execution without an effective `ALLOW` decision from the Decision Arbiter, or permit authority/taint to cross session boundaries contrary to the documented policy model?"**

In addition, assessors are provided with complete container vulnerability forensics comparing the baseline candidate `v0.1.0-rc1` against the hardened candidate `v0.1.1-rc1`. All source repositories, Dockerfiles, configuration files, test harnesses, cryptographic manifests, machine-readable SBOMs, and audit reports are indexed below.

---

## 2. Release Identity & Dual-Candidate Provenance Chain

```mermaid
graph TD
    subgraph "Forensic Baseline (v0.1.0-rc1 - Frozen)"
        A1[Source Commit Git SHA: 4331fa92305bf9c4d25785089e52e46b9a896d8e] --> B1[Dockerfile SHA-256: ffdc470700ef351d8a819e0e2195a8c289ca9a09ec155de3d2e84a7aac23d3d2]
        B1 --> C1[Baseline Image ID: sha256:ac89dd94a7331dc9655858cec0be93e31d39d1236cd4bdec0c7eca27f49255e3]
        C1 --> D1[Trivy Findings: 263 total<br/>3 Critical / 62 High / 86 Medium / 92 Low]
    end

    subgraph "Hardened Remediated Candidate (v0.1.1-rc1)"
        A2[Branch Commit Git SHA: 4331fa468f70a7887a9e41cad92e8a12d4b48f80] --> B2[Multi-Stage Dockerfile SHA-256: 15245b7bcdd9e247801d08ea28104cb1a7e11ca6c78665871ff75cad22520b8d]
        B2 --> C2[Hardened Image ID: sha256:d76cfdcd5d5f07f6fd0a0c5151272b0959567ccd9602952a2f34d23a16238c71]
        C2 --> D2[Trivy Findings: 33 total<br/>0 Critical / 0 High / 29 Medium / 4 Low<br/>87.5% reduction]
        C2 --> E2[Live Container Dominance Probe: 4/4 PASS<br/>BackendExecution > 0 ==> Decision == ALLOW]
        A2 --> F2[CycloneDX 1.5 SBOM: 835110c1...]
        A2 --> G2[SPDX 2.3 SBOM: 0300b621...]
        A2 --> H2[40/40 Host Invariant Test Suite: 100% Pass]
        C2 --> I2[Release Manifest: gateway_security_release_manifest.json<br/>SHA-256: c9d86f0e...]
        D2 --> I2
        E2 --> I2
        F2 --> I2
        G2 --> I2
        H2 --> I2
    end
```

### Authoritative Artifact Identifiers

| Layer / Artifact Component | Forensic Baseline (`v0.1.0-rc1`) | Hardened Candidate (`v0.1.1-rc1`) | Status / Notes |
| :--- | :--- | :--- | :--- |
| **Git Commit SHA** | `4331fa92305bf9c4d25785089e52e46b9a896d8e` | `b880f3eb76ad28906875cdd3b1dfcab1aaca69ca` | Canonical release `v0.1.1-rc1` (container base `4331fa4`, superseding commercial milestone `aa1cc5a`) |
| **Release Tag / Identifier** | `v0.1.0-rc1` (Frozen Baseline) | `v0.1.1-rc1` (Canonical Release Candidate) | Separate release candidate |
| **Container Spec (Dockerfile)** | `ffdc470700ef351d8a819e0e2195a8c2...` | `15245b7bcdd9e247801d08ea28104cb1a7e11ca6c78665871ff75cad22520b8d` | Multi-stage, stripped build tools |
| **Container Base OS** | `python:3.11-slim (Debian 12 Bookworm)` | `ubuntu:24.04 (Noble Numbat)` | Ubuntu LTS runtime |
| **Base Image Digest** | Upstream Debian library | `docker.io/library/ubuntu:24.04@sha256:33ceb71981b602c1a7443a53469e4dba065f7503eab3078a2d7a57a2ab987517` | Exact build base digest |
| **Container Runtime User** | `mastyf` (UID 10001) | `mastyf` (UID 10001) | Non-root runtime enforced |
| **Container Image ID** | `sha256:ac89dd94a7331dc9655858cec0...` | `sha256:d76cfdcd5d5f07f6fd0a0c5151272b0959567ccd9602952a2f34d23a16238c71` | Docker inspect content-addressed ID |
| **Container Image Tag** | `mastyf-gateway:0.1.0-rc1` | `mastyf-gateway:0.1.1-rc1` | Local build verified |
| **Trivy Image Scan Report** | [`reports/trivy_image_scan.json`](file:///Users/rudraneeldas/Projects/mastyf-full/mastyf_gateway/reports/trivy_image_scan.json) | [`reports/trivy_image_scan_remediated_v0.1.1.json`](file:///Users/rudraneeldas/Projects/mastyf-full/mastyf_gateway/reports/trivy_image_scan_remediated_v0.1.1.json) | SHA-256: `4ea6ae25bafa...` |
| **Trivy Vulnerability Profile** | 263 (3 Crit, 62 High, 86 Med, 92 Low) | 33 (0 Crit, 0 High, 29 Med, 4 Low, 0 Sec) | **87.5% reduction; 0 Critical, 0 High** |
| **Residual Risk Dispositions** | N/A (Baseline blocked by High/Crit) | [`reports/trivy_residual_risk_dispositions.md`](file:///Users/rudraneeldas/Projects/mastyf-full/mastyf_gateway/reports/trivy_residual_risk_dispositions.md) | SHA-256: `5c4ac8cb84db...` |
| **Container Dominance Probe** | Not tested containerized | [`tests/integration/test_containerized_dominance_probe.py`](file:///Users/rudraneeldas/Projects/mastyf-full/mastyf_gateway/tests/integration/test_containerized_dominance_probe.py) | **4/4 PASS live via HTTP REST** (SHA-256: `bd0554a7...`) |
| **Supply Chain CycloneDX 1.5** | `1e6676cadf3a5755ab1c692ad43cc4b6...` | `835110c1d93af0e8f244bceb66b8a3b7c28e0d36708ae60d4accce0efd09b29b` | Regenerated for v0.1.1 |
| **Supply Chain SPDX 2.3** | `47b1abe5a997ffb5c23ef0555b140e8...` | `0300b6216e9e7dc9fe62568ad15af7a88dd57c8514e08e7bcc286cc2d68f0351` | Regenerated for v0.1.1 |
| **Static AST Audit (Bandit)** | 0 High, 1 Med (B104), 5 Low | 0 High, 1 Med (B104), 6 Low | SHA-256: `d823915850d0...` |
| **Dependency CVE Scan** | 0 known vulnerabilities (42 pkgs) | 0 known vulnerabilities (42 pkgs) | SHA-256: `76a9acd9dc86...` |
| **Semgrep Architectural** | 4 rules, 0 findings | 4 rules, 0 findings | SHA-256: `e552ed46d8cc...` |
| **Semgrep Security Audit** | 80 rules, 0 findings | 80 rules, 0 findings | SHA-256: `f11675b4a7b1...` |
| **Trivy Filesystem Scan** | 0 vulnerabilities, 0 secrets | 0 vulnerabilities, 0 secrets | SHA-256: `e9f98aa456e4...` |
| **Trivy Configuration Scan** | 27/27 checks passed | 27/27 checks passed | SHA-256: `1669219b998d...` |
| **MCP Deployment Ledger** | `18e0be202aa1d48775a48c545f798ce4...` | `18e0be202aa1d48775a48c545f798ce47724077ece123779b4c7a8b4598ef1a8` | 60 requests / 3 clients / 0 leaks |
| **Security Release Manifest** | `7531dc298aad187e86af7b1320072609...` | `22eea22cdf1eda8995cedcfdf8b3f188ded388aa650cd912f8f03bca87e24161` | Cryptographically bound v1.1 |
| **Neural Research LoRA** | Hugging Face: `d59a6aa01f9139dff...` | Hugging Face: `d59a6aa01f9139dff106146addb04109afa69c03` | Frozen V6 checkpoint |
| **Derived Deployment GGUF** | SHA-256: `513bd5d0d5a460476a8b7a...` | SHA-256: `513bd5d0d5a460476a8b7afac45a4c6d865eeff8e140ba0ec2c82abaacce0ecf` | Q4_K_M native binary |

### Container Build Reproducibility & RootFS Specification

While the released image ID (`sha256:d76cfdcd5d5f07f6fd0a0c5151272b0959567ccd9602952a2f34d23a16238c71`) is immutable and content-addressed for assessor inspection, the Dockerfile builds from tag `ubuntu:24.04`. The digest below represents the exact **resolved base image used for this candidate release build** rather than a Dockerfile digest pin:

- **Resolved Base Image Reference:** `docker.io/library/ubuntu:24.04@sha256:33ceb71981b602c1a7443a53469e4dba065f7503eab3078a2d7a57a2ab987517`
- **RootFS Layer Composition (7 Layers):**
  1. `sha256:646eea22414270d74b0c9e9d6d3b9550701ae62e658a099825d4d15045a3630b`
  2. `sha256:d600c6d478cc56be83d65f4469b3a56fb75cb171539804102db4df07f79f0fe5`
  3. `sha256:a611371bff346eea4350e19bcdc894694dcc27bda908deb032c5648f258196a4`
  4. `sha256:3dba17fce9bc5bf28b815c823e868d7299a2866fe4dc9baf3f3c43a1e61c1594`
  5. `sha256:f9cafea3b345257811929ddffa8796f772f8b784feb65a6b66c3f83bd21a20c5`
  6. `sha256:6fb8804a2e1db0e8436d3246200cc429a382d2994f47b1ab4dfb87146b2524ae`
  7. `sha256:9fbfc48d217a1af5ea577a08bad8cb005a4f83775d6f57485516ab95e790fa3f`

---

## 3. Security Architecture & Complete Mediation Model

The Mastyf Security Gateway acts as an inline reference monitor intercepting AI-agent tool calls (via MCP JSON-RPC or REST `/v1/gateway/evaluate`).

```text
AI Agent / MCP Client
         │ (JSON-RPC tools/call or REST /v1/gateway/evaluate)
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                 MASTYF SECURITY REFERENCE MONITOR               │
│                                                                 │
│  [Stage 1] Deterministic Capability-Based Access Control (CBAC) │
│            - Principal authorization scoping                    │
│            - Strict argument type, bounds, regex enforcement    │
│            - Explicit deny-pattern matching                     │
│                                                                 │
│  [Stage 2] Decentralized Information Flow Control (DIFC)        │
│            - Dynamic session taint tracking                     │
│            - Untrusted source taint accumulation                │
│            - Strict confinement at sensitive sinks              │
│                                                                 │
│  [Stage 3] Active Intent Auditor (AIA) - Semantic Fallback      │
│            - Neural intent inspection (Frozen V6)               │
│            - Structured JSON schema enforcement                 │
│            - Hard execution timeout fail-closed fallback        │
│                                                                 │
│  [Stage 4] Decision Arbiter                                     │
│            - Enforces Authority Monotonicity Invariant          │
│            - Dominates downstream tool dispatch                 │
└─────────────────────────────────────────────────────────────────┘
         │
         ├── Decision != ALLOW ──> Immediate Block (Backend Calls == 0)
         │
         └── Decision == ALLOW ──> Dispatch to Target MCP Tool Server
```

### Mathematical Invariants Guaranteed by Architecture

1. **Authority Monotonicity:**
   $$\text{Authority}(\text{Final}) \subseteq \text{Authority}(\text{CBAC}) \cap \text{Authority}(\text{DIFC})$$
   A permissive semantic auditor can *never* override an underlying deterministic CBAC or DIFC denial.

2. **Arbiter Dominance:**
   $$\text{BackendExecutionCount} > 0 \implies \text{Decision} = \text{ALLOW}$$
   No downstream tool logic is invoked unless the Arbiter reaches an explicit `ALLOW`. In the tested deployment paths, authorized `ALLOW` requests were forwarded to the backend and recorded in the downstream execution ledger.

3. **Fail-Closed Security:**
   $$\text{Fault} \in \{\text{Timeout}, \text{MalformedJSON}, \text{MissingPolicy}, \text{UnknownTool}, \text{Exception}\} \implies \text{Decision} \in \{\text{BLOCK}, \text{ESCALATE}\}$$

4. **Taint Monotonicity:**
   $$\forall t_2 \ge t_1, \quad \text{Taint}(S, t_1) \subseteq \text{Taint}(S, t_2)$$
   Session taints strictly accumulate across successive tool executions and can never be silently cleared or transferred.

---

## 4. Empirical Verification & Invariant Evidence

### A. 40/40 Invariant & Security Regression Suite
- **Framework:** `pytest-9.0.3` under Python 3.13.1.
- **Result:** 40 passed, 0 failed in 9.54 seconds.
- **Coverage:**
  - `test_arbiter_dominance_bypass.py`: Monotonic mock backend asserting zero execution on non-ALLOW decisions.
  - `test_fail_closed.py`: Component fault injections failing closed across all paths.
  - `test_session_isolation.py`: Zero authority crossover across 50 concurrent interleaved clean vs tainted sessions.
  - `test_authority_monotonicity.py`: Invariant enforcement across lattice states.
  - `test_decision_matrix.py`: Full truth table coverage.
  - `test_fuzzing.py`: Argument boundary and mutation fuzzing.

### B. Live Containerized Dominance Invariant Probe
- **Target:** Live running hardened container (`mastyf-gateway:0.1.1-rc1`, image ID `sha256:d76cfdcd...`) running under non-root UID 10001, accessed over HTTP REST at `http://localhost:8000`.
- **Harness:** [`mastyf_gateway/tests/integration/test_containerized_dominance_probe.py`](file:///Users/rudraneeldas/Projects/mastyf-full/mastyf_gateway/tests/integration/test_containerized_dominance_probe.py)
- **Results:** 4/4 rows verified live:

| Probe Row | Scenario | Gateway Decision | Execution Permitted | ΔBackendExecutions | Cumulative Invocations | Invariant Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Row 1** | Authorized clean principal (`admin_user`, `transfer_funds`) | `ALLOW` | `True` | **+1** (executed) | 1 | **PASS** |
| **Row 2** | Unauthorized principal (`unauthorized_guest`, `transfer_funds`) | `BLOCK` | `False` | **0** (untouched) | 1 | **PASS** |
| **Row 3** | Tainted exfiltration (`UNTRUSTED_WEB` $\to$ `send_email`) | `BLOCK` | `False` | **0** (untouched) | 1 | **PASS** |
| **Row 4** | Unknown tool / fallback (`system_exec_unregistered`) | `BLOCK` / `ESCALATE` | `False` | **0** (untouched) | 1 | **PASS** |

> **Audit Observation:** Cumulative backend execution count remained 1 after all four probes; only the authorized baseline request executed.

$$\boxed{\text{BackendExecutionCount} > 0 \implies \text{Decision} = \text{ALLOW} \quad \text{--- VERIFIED IN LIVE CONTAINER}}$$

### C. Multi-Client MCP Deployment Ledger Audit
- **Harness:** [`mastyf_gateway/benchmarks/run_real_mcp_deployment_ledger.py`](file:///Users/rudraneeldas/Projects/mastyf-full/mastyf_gateway/benchmarks/run_real_mcp_deployment_ledger.py)
- **Artifact:** [`mastyf_gateway/reports/mcp_multi_client_deployment_ledger.json`](file:///Users/rudraneeldas/Projects/mastyf-full/mastyf_gateway/reports/mcp_multi_client_deployment_ledger.json) (SHA-256: `18e0be20...`)
- **Execution:** 60 concurrent requests across 3 distinct client archetypes:
  - Client A (Authorized Clean Principal): 20 requests $\to$ 20 `ALLOW` $\to$ 20 backend tool invocations.
  - Client B (Adversarial Unauthorized Principal): 20 requests $\to$ 20 `BLOCK` $\to$ 0 backend tool invocations.
  - Client C (Tainted Exfiltration Attempt): 20 requests $\to$ 20 `BLOCK` $\to$ 0 backend tool invocations.
- **Observed Invariant Violations:** Exactly **0**.

---

## 5. Container Hardening, Static Analysis & Vulnerability Evidence

### A. Container Vulnerability Remediation (`v0.1.0-rc1` vs `v0.1.1-rc1`)

| Metric / Category | Baseline `v0.1.0-rc1` | Remediated `v0.1.1-rc1` | Remediation Action / Notes |
| :--- | :--- | :--- | :--- |
| **Total Findings** | 263 | **33** | **87.5% reduction** |
| **Critical Findings** | 3 | **0** | Eliminated via multi-stage build & clean base |
| **High Findings** | 62 | **0** | Eliminated via uninstallation of pip/wheel/setuptools & Debian base swap |
| **Medium Findings** | 86 | **29** | Documented & dispositioned (24 unreached CPython `libexpat1`, 5 unreached core C libs) |
| **Low Findings** | 92 | **4** | Documented & dispositioned (`coreutils`, `pcre2`, `tar`) |
| **Unknown Findings** | 20 | **0** | Completely eliminated |
| **Secrets Detected** | 0 | **0** | Clean |
| **Runtime User** | `mastyf` (10001) | `mastyf` (10001) | Non-root least privilege |
| **Build Tools in Runtime** | Present (`pip`, `setuptools`) | **Purged** (`pip`, `setuptools`, `wheel` uninstalled) | Attack surface minimized |

### B. Residual Risk Disposition Matrix (`v0.1.1-rc1`)

All 33 residual findings in `mastyf-gateway:0.1.1-rc1` have been audited for reachability and operational risk:
- **`libexpat1` (24 Medium CVEs):** AST code inspection verifies that `mastyf_gateway` has zero imports or references to `xml`, `expat`, `xml.etree`, or `minidom`. The gateway processes exclusively JSON (via Pydantic V2 / Rust `pydantic-core`) and JSON-RPC. `libexpat1` is an unreached shared library dependency of CPython that cannot be invoked through any gateway network ingress path.
- **Upstream C-Core Libraries (`glibc`, `libsystemd0`, `libzstd1`, `coreutils`, `pcre2`, `tar` - 5 Medium, 4 Low):** Standard base OS system libraries. The gateway runs with no shell evaluation (`os.system` / `subprocess` unreached on request paths), non-root UID 10001, and no external command execution capabilities.
- **Detailed Audit Document:** See [`reports/trivy_residual_risk_dispositions.md`](file:///Users/rudraneeldas/Projects/mastyf-full/mastyf_gateway/reports/trivy_residual_risk_dispositions.md) (SHA-256: `5c4ac8cb84db...`).

### C. Static AST Analysis (Bandit 1.9.4)
- **Report:** [`reports/bandit_scan.json`](file:///Users/rudraneeldas/Projects/mastyf-full/mastyf_gateway/reports/bandit_scan.json)
- **Findings:** 0 High, 1 accepted Medium (`B104` `0.0.0.0` container bind, overrideable via `MASTYF_HOST`), 6 Low (developer CLI test commands and defensive exception pass).

### D. Dependency Vulnerability Screening (pip-audit 2.10.1)
- **Report:** [`reports/dependency_cve_scan.json`](file:///Users/rudraneeldas/Projects/mastyf-full/mastyf_gateway/reports/dependency_cve_scan.json)
- **Findings:** 0 known vulnerabilities found across 42 evaluated direct and transitive dependencies against the PyPI Advisory Database at scan time.

### E. Architectural & Security Semgrep Audits (Semgrep 1.176.1)
- **Targeted Architectural Rules:** [`rules/mastyf_arbiter_dominance.yml`](file:///Users/rudraneeldas/Projects/mastyf-full/mastyf_gateway/rules/mastyf_arbiter_dominance.yml) (0 findings across 26 source files). Negative-control synthetic test confirmed rule sensitivity against unmediated execution.
- **Community Security Audit:** `p/security-audit` ruleset (80 rules across 54 files, 0 findings).

### F. Trivy Filesystem & Configuration Scans (Trivy 0.74.0)
- **Filesystem Scan:** [`reports/trivy_fs_scan.json`](file:///Users/rudraneeldas/Projects/mastyf-full/mastyf_gateway/reports/trivy_fs_scan.json) (0 vulnerabilities, 0 secrets).
- **Configuration Scan:** [`reports/trivy_config_scan.json`](file:///Users/rudraneeldas/Projects/mastyf-full/mastyf_gateway/reports/trivy_config_scan.json) (27/27 checks passed; non-root user UID 10001 enforced per `DS-0002`).

### G. Machine-Readable SBOMs
- **CycloneDX 1.5 JSON:** [`reports/sbom_cyclonedx.json`](file:///Users/rudraneeldas/Projects/mastyf-full/mastyf_gateway/reports/sbom_cyclonedx.json) (SHA-256: `835110c1...`)
- **SPDX 2.3 JSON:** [`reports/sbom_spdx.json`](file:///Users/rudraneeldas/Projects/mastyf-full/mastyf_gateway/reports/sbom_spdx.json) (SHA-256: `0300b621...`)

---

## 6. Performance Characterization & Neural Weights Lineage

- **Deterministic Fast-Path Latency:** Measured at **2.8–2.9 $\mu$s P50** with sustained throughput >335,000 req/s across $1 \to 1,000$ concurrency in-process.
- **Semantic AIA Latency:** Profiled at **24.25 ms P50** at 1,000 concurrency under simulated neural inference.
- **Native GGUF CPU Latency:** Profiled via `llama-cli` at **3.211 s P50 / 3.758 s P95**.
- **Canary Suite Equivalence:** 50/50 agreement across LoRA Adapter $\to$ Merged FP16 $\to$ Q4_K_M GGUF with zero security downgrades.

---

## 7. Post-Handoff Protocol & Branching Policy

To maintain the forensic validity of the assessment target:
1. The release candidate `v0.1.0-rc1` is **completely frozen** as the immutable forensic baseline.
2. Container remediation and application factory adjustments have been conducted exclusively on branch `harden-container-v0.1.1-rc1`.
3. Candidate `v0.1.1-rc1` establishes zero Critical and zero High container findings, verified 4-row live container dominance, regenerated SBOMs, and an updated cryptographic release manifest.
4. Both the baseline image (`sha256:ac89dd94...`) and the hardened image (`sha256:d76cfdcd...`) remain preserved for independent comparative verification.

---

*Mastyf Security Gateway Team — Official Independent Assessment Dossier*
