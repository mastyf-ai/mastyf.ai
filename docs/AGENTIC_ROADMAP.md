# MCP Guardian — Agentic AI Roadmap (Industry Standard)

This document describes capabilities that extend MCP Guardian from per-server, per-call protection to **cross-server, cross-agent, systemic** security — the layer enterprise CISOs need to mandate Guardian across an entire MCP fleet.

**Status key:** Shipped = in `src/agentic/` today · Foundation = partial building blocks exist · Planned = roadmap

**Industry-standard roadmap (A1–C5):** Shipped in v4.0 — see modules below and [`tests/agentic/roadmap-industry-standard.test.ts`](../tests/agentic/roadmap-industry-standard.test.ts).

---

## Current strength (shipped — do not duplicate)

| Area | Modules | Docs |
|------|---------|------|
| Per-call injection | `prompt-injection/*`, semantic async gate | [AGENTIC_FEATURES.md](AGENTIC_FEATURES.md) |
| Threat prediction | `threat-prediction/*` | §1 |
| Policy generation | `policy-gen/*` | §2 |
| Threat mesh (opt-in) | `threat-mesh/*`, `mesh-relay-client.ts` | §3 |
| Honeypots | `honeypot/*` | §4 |
| Supply chain | `supply-chain/*` | §5 |
| Compliance mapping | `compliance/control-mapper.ts`, evidence runner | §7 |
| Drift & rollback | `drift/*` | §8 |
| Red team & fuzzing | `red-team/*`, `protocol-fuzzer/*` | §9 |
| Trust negotiation | `trust-negotiation/*`, `trust-score/*` | §10 |
| Collusion & chains | `collusion-detector/*`, session chain detector | Foundation for A1 |
| Agent reputation | `agent-reputation/*` | Foundation for A3, B1 |
| Capability graph | `capability-graph/*` | Foundation for A1 |
| Intent binding | `intent-binding/*` | Foundation for C3 |
| Sandbox tiers | `sandbox-tier/*` | Foundation for A2 |
| Certification | `certification/*`, MTX records | Foundation for B1 |
| Incident playbook | `incident-playbook/*`, AI investigator | Dashboard + API |

---

## Tier 1 — Paradigm-shifting

### A1: Cross-MCP Causal Attack Chain Detection · Shipped

**Module:** [`cross-chain/fleet-chain-detector.ts`](../src/agentic/cross-chain/fleet-chain-detector.ts) · API `GET /api/agentic/fleet-chains`

### A2: MCP Server Digital Twin & Policy Sandbox · Shipped

**Module:** [`digital-twin/twin-capture.ts`](../src/agentic/digital-twin/twin-capture.ts) · API `POST /api/agentic/digital-twin/scorecard`

### A3: AI Agent Behavioral Biometrics · Shipped

**Module:** [`biometrics/behavior-fingerprint.ts`](../src/agentic/biometrics/behavior-fingerprint.ts) · policy strategy `behavioral-biometrics` · API `GET /api/agentic/biometrics/*`

---

## Tier 2 — Ecosystem-level

### B1: Decentralized MCP Reputation Network · Shipped

**Module:** [`reputation/reputation-network.ts`](../src/agentic/reputation/reputation-network.ts) · MCP `query_server_reputation` · Cloud `GET /api/v1/reputation/query`

### B2: MCP Ecosystem Health Observatory · Shipped

**Module:** [`observatory/ecosystem-observatory.ts`](../src/agentic/observatory/ecosystem-observatory.ts) · API `GET /api/agentic/observatory/snapshot` · Cloud `GET /api/v1/observatory/snapshot`

### B3: Federated Learning for Threat Detection · Shipped (research flag)

**Module:** [`federated/federated-learning.ts`](../src/agentic/federated/federated-learning.ts) · enable with `GUARDIAN_FEDERATED_LEARNING=true`

---

## Tier 3 — Enterprise-defining

### C1: MCP Configuration Provenance & Verifiable Audit Chain · Shipped

**Module:** [`provenance/config-provenance-chain.ts`](../src/agentic/provenance/config-provenance-chain.ts) · CLI `guardian policy provenance-verify|provenance-export`

### C2: Threat Modeling as Code (STRIDE / LINDDUN) · Shipped

**Module:** [`threat-modeling/stride-linddun.ts`](../src/agentic/threat-modeling/stride-linddun.ts) · CLI `guardian threat-model` · CI [`.github/workflows/threat-model-regen.yml`](../.github/workflows/threat-model-regen.yml)

### C3: Zero-Trust Continuous Verification Engine · Shipped

**Module:** [`zero-trust/verification-engine.ts`](../src/agentic/zero-trust/verification-engine.ts) · policy strategy `zero-trust-score`

### C4: Cyber Insurance Risk Quantification · Shipped

**Module:** [`insurance/risk-quantifier.ts`](../src/agentic/insurance/risk-quantifier.ts) · MCP `quantify_insurance_risk`

### C5: Semantic Policy Translator · Shipped

**Module:** [`semantic-policy/translator.ts`](../src/agentic/semantic-policy/translator.ts) · MCP `policy_to_natural_language`, `natural_language_to_policy` · Dashboard Semantic Policy panel

---

## Recommended build order (12 months)

| Phase | Months | Deliverables |
|-------|--------|--------------|
| **1 — Quick wins** | 1–3 | C5, C1, C2, A3 foundations |
| **2 — Differentiators** | 4–6 | A1, A2, C3 |
| **3 — Ecosystem** | 7–9 | B1, B2, C4 |
| **4 — Research** | 10–12 | B3 federated learning |

---

## Why this becomes industry standard

- **Network effects:** B1 + B2 — more deployments → better data → more value
- **Regulatory alignment:** C1 + C2 + C3 — EO 14028, FedRAMP Rev 5, EU AI Act, PCI-DSS 4.0
- **No direct competition** on cross-MCP chains, digital twins, or agent biometrics today
- **Expanded buyers:** C4 (CFO/insurance), C5 (compliance), C2 (security architects)
- **Compounding moat:** B3 federated learning improves with every opt-in deployment

See also: [AGENTIC_FEATURES.md](AGENTIC_FEATURES.md) (shipped) · [AGENTIC_ARCHITECTURE.md](AGENTIC_ARCHITECTURE.md)
