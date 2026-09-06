# Mastyf Guard — Canonical Release & Identifier Sheet
*Release Candidate: `v0.1.1-rc1` • Model Checkpoint: `V6 (Frozen)` • Zenodo: `v2.1`*
*Date of Audit: September 6, 2026 • Status: Fully Reconciled & Pinned*

---

## 1. Public & Gated Model Repositories (Hugging Face)

| Repository Name | Role / Classification | Pinned Commit SHA | Access Mode | Live URL |
| :--- | :--- | :--- | :--- | :--- |
| **`Rudraneel93/mastyf-guard-1.5b-v2-boundary-sharpened`** | **Current Flagship Deployment Checkpoint** (Advisory Semantic Auditor) | `74d569a21c5be477a798f44011fdb5b3ce96eb0c` (Root README) / Weight Rev `d59a6aa01f9139dff106146addb04109afa69c03` | **Gated** (Requires Lemon Squeezy license key via `/api/v1/activate`) | [Hugging Face Model Page](https://huggingface.co/Rudraneel93/mastyf-guard-1.5b-v2-boundary-sharpened) |
| **`Rudraneel93/mastyf-guard-1.5b`** | **Historical Research Baseline** (Superseded by V6 for active deployments) | `94cafec8cd8a0717d0a9ef079f064316f83b2c8d` (Root README) | **Gated** (Archival research / developer preview) | [Hugging Face Model Page](https://huggingface.co/Rudraneel93/mastyf-guard-1.5b) |

### Flagship V6 Architecture & Framing Disclosures
* **Role in TCB:** Advisory semantic-audit component operating within the Mastyf Security Gateway.
* **Authority Bound:** Zero authority expansion ($\text{Final} = \text{ALLOW} \implies \text{CBAC} = \text{ALLOW} \land \text{DIFC} = \text{ALLOW} \land \text{AIA} = \text{ALLOW}$).
* **Empirical Verification Disclosed:** 50/50 live canary verification, 48/50 raw JSON compliance, 3.211s P50 CPU latency.

---

## 2. Research Publications & Permanent DOIs (Zenodo)

| Artifact Dimension | Identifier / Record | Live Target URL | Status |
| :--- | :--- | :--- | :--- |
| **Concept DOI (Permanent)** | `10.5281/zenodo.22179415` | [https://doi.org/10.5281/zenodo.22179415](https://doi.org/10.5281/zenodo.22179415) | Resolves to latest release |
| **Version 2.1 Release DOI** | `10.5281/zenodo.22463320` | [https://doi.org/10.5281/zenodo.22463320](https://doi.org/10.5281/zenodo.22463320) | Active Version Record |
| **Zenodo Live Record URL** | Record ID `22463320` | [https://zenodo.org/records/22463320](https://zenodo.org/records/22463320) | Verified Open Access |
| **Direct Manuscript Download** | File: `mastyf-guard.pdf` | [Download PDF](https://zenodo.org/api/records/22463320/files/mastyf-guard.pdf/content) | 6,817,763 bytes (MD5: `15a28669096634f95a256d3a30d0851b`) |
| **Source Bundle Download** | File: `techrxiv_submission_bundle.zip` | [Download ZIP](https://zenodo.org/api/records/22463320/files/techrxiv_submission_bundle.zip/content) | 13,493,679 bytes (MD5: `e3e4df9b130dd02eef58888a62ad0791`) |

---

## 3. Gateway Source Code & Release Lineage (GitHub)

| Repository Name | Role | Release Tag / Commit | Default Branch | Live URL |
| :--- | :--- | :--- | :--- | :--- |
| **`rudraneel93/mastyf-gateway`** | Dedicated Software Gateway Runtime & Standalone CLI | Tag `v0.1.1-rc1` (`c8371ec22d`) | `main` | [GitHub Repository](https://github.com/rudraneel93/mastyf-gateway) |
| **`mastyf-ai/mastyf.ai`** | Core Platform Monorepo (Cloud, Evaluators, Harnesses) | Tag `v0.1.1-rc1` (`acb072e`) | `main` | [GitHub Repository](https://github.com/mastyf-ai/mastyf.ai) |

### Versioning Provenance & Disambiguation
* **Evaluated Research Baseline Runtime:** `v0.1.0-RC1` (verifying 38/38 automated security invariant tests, documented in manuscript).
* **Hardened Commercial-Pilot Runtime:** `v0.1.1-rc1` (extending automated suite to 50/50 tests, multi-stage non-root container lifecycle, and Ed25519 commercial licensing).

---

## 4. Cryptographic Checksums & Artifact Integrity

| Component | Target File / Artifact | SHA-256 Digest |
| :--- | :--- | :--- |
| **Frozen V6 Checkpoint** | Adapter Weights & Config | `d59a6aa01f9139dff106146addb04109afa69c03` (Git Revision) |
| **Derived Quantized GGUF** | `mastyf-guard-v6-q4_k_m.gguf` | `513bd5d0d5a460476a8b7afac45a4c6d865eeff8e140ba0ec2c82abaacce0ecf` |
| **Production Container** | Image `mastyf-gateway:0.1.1-rc1` | `d76cfdcd5d5f07f6fd0a0c5151272b0959567ccd9602952a2f34d23a16238c71` |
| **Canonical Manuscript** | `mastyf-guard.pdf` (14 Pages) | `7a1bc7e1635338006bca262846fcbb0dff6fecaa6b3c96291a1824a6ffc6bfa0` |
| **Release Manifest** | `gateway_security_release_manifest.json` | `22eea22cdf1eda8995cedcfdf8b3f188ded388aa650cd912f8f03bca87e24161` |
| **CycloneDX 1.5 SBOM** | `reports/sbom_cyclonedx.json` | `835110c1d93af0e8f244bceb66b8a3b7c28e0d36708ae60d4accce0efd09b29b` |
| **SPDX 2.3 SBOM** | `reports/sbom_spdx.json` | `0300b6216e9e7dc9fe62568ad15af7a88dd57c8514e08e7bcc286cc2d68f0351` |

---

## 5. Commercial Entitlement Architecture

| Parameter | Specification | Posture |
| :--- | :--- | :--- |
| **Commercial Tier** | Mastyf Guard Pro (₹2,500/month) / Enterprise Custom | Active |
| **Billing Platform** | Lemon Squeezy (Store ID 136279) | Live Webhooks Verified |
| **Licensing Engine** | `POST /api/v1/activate` | Cryptographic permanent identity binding |
| **Entitlement Crypto** | Asymmetric Ed25519 Token | Server Private / Client Public (`mastyf-prod-2026-01`) |
| **Offline Resilience** | 7-Day Grace Window | Non-blocking background renewal |
| **Local Privacy** | Zero PII in `~/.mastyf/entitlement.json` | Fully Compliant |
