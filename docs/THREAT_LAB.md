# Threat Lab — LLM Threat Discovery

Threat Lab uses local Ollama (`LlmAssistant`) to discover novel attack classes, propose corpus fixtures, and suggest YAML policy rules for Security Swarm training.

![Threat Lab Architecture](../docs/assets/llm-threat-discovery-architecture.png)

## Overview

| Phase | What it does |
|-------|----------------|
| **Phase 1** | Swarm agent proposes + validates candidates → `threat-lab-candidates.json` |
| **Phase 2** | Runtime bridges: semantic TPs, ThreatIntel, instant LLM argPatterns |
| **Phase 3** | `pnpm ai:export-training-data` → future LoRA fine-tune (stub) |

**Safety:** Manual Threat Lab path still requires human review (dashboard accept or `open-corpus-pr.mjs`). **Auto Threat Research** (see below) writes `adv-*.json` fixtures directly with validation gates but no human review.

**Production invariant:** Threat Lab requires a healthy LLM. It does **not** emit synthetic or deterministic fallback candidates. If Ollama is unavailable or there are no authentic inputs, the agent skips cleanly.

## Authentic data sources

| Source | When used | Notes |
|--------|-----------|-------|
| Swarm bypasses | Always (reactive); optional in proactive | `bypasses.json`, harness eval failures |
| Human-labeled semantic TPs | When `SWARM_THREAT_LAB_SEMANTIC` ≠ `false` | Excludes calibrator-seeded records |
| ThreatIntel (NVD/OSV/GitHub) | Default on | Live poll before discovery |
| Corpus attacks | Proactive mode only | Real fixtures from `corpus/attacks/` as LLM mutation seeds |

Calibrator seed rows (`Swarm seed from live MCP (...)`) are **opt-in only** (`SWARM_CALIBRATE_SEED_FROM_LIVE=true`) and are **never** fed to Threat Lab.

## Quick start

```bash
# Enable Threat Lab (Pro license required)
export SWARM_THREAT_LAB=true
export GUARDIAN_LLM_ENABLED=true
export OLLAMA_BASE_URL=http://localhost:11434
ollama serve   # ensure model is pulled, e.g. ollama pull qwen3:8b

# Reactive (default): discover from swarm bypasses
export SWARM_THREAT_LAB_MODE=reactive
pnpm security-swarm:threat-lab

# Proactive: corpus-seeded LLM red-team (no synthetic category probes)
export SWARM_THREAT_LAB_MODE=proactive
pnpm security-swarm:threat-lab

# One-click analysis (includes Threat Lab when env set)
pnpm security-swarm:analyze
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SWARM_THREAT_LAB` | off | Enable Threat Lab agent |
| `SWARM_THREAT_LAB_MAX` | `10` | Max candidates per run |
| `SWARM_THREAT_LAB_MODE` | `reactive` | `reactive` (bypass-driven) or `proactive` (corpus-seeded) |
| `SWARM_THREAT_LAB_REQUIRE_LLM` | `true` | Skip run when Ollama unavailable (no fallback) |
| `SWARM_THREAT_LAB_REQUIRE_REPLAY` | on | Require corpus fixture blocked by current policy |
| `SWARM_THREAT_LAB_SEMANTIC` | on | Include human-labeled semantic audit TPs |
| `SWARM_THREAT_LAB_THREAT_INTEL` | on | Poll + include ThreatIntel catalog entries |
| `SWARM_THREAT_LAB_LLM_TIMEOUT_MS` | `120000` | Batch LLM timeout (bypasses 500ms hot-path cap) |
| `SWARM_THREAT_LAB_LLM_MAX_TOKENS` | `2048` | Max tokens per Threat Lab Ollama call |
| `SWARM_CALIBRATE_SEED_FROM_LIVE` | off | Opt-in calibrator seed (excluded from Threat Lab) |
| `SWARM_CALIBRATE_AUTO_LABEL` | off | Auto-label suspicious records (off in production) |
| `GUARDIAN_LLM_*` / `OLLAMA_BASE_URL` | — | Local Ollama configuration |

## Outputs

- `reports/security-swarm/threat-lab-candidates.json` — signed manifest with provenance (`source`, `llmUsed`)
- `adversarial-harness/fixtures/custom-attacks/adv-NNN.json` — harness fixtures for every queued candidate
- Dashboard **Swarm** tab → **Threat Lab candidates** (accept/reject)
- **Enterprise AI → Open in Threat Lab** reopens the incident investigation drawer on the Threat Lab workbench and links `semantic-tp` candidates by `provenance.inputFingerprint` (semantic audit id)

## Promotion workflow

```bash
node security-swarm/scripts/open-corpus-pr.mjs --dry-run
node security-swarm/scripts/open-corpus-pr.mjs
# Push branches and open PRs — human review required
```

Fallback and non-LLM candidates are rejected at promotion time.

## Runtime learning (Phase 2)

- **Semantic TP label** (`POST /api/learning/label`) → Threat Lab bridge → pending suggestions (TP-only, replay required)
- **ThreatIntel catalog** → live poll + optional LLM enrichment in `SuggestionEngine.runLearningCycle()`
- **`GUARDIAN_AI_INSTANT_LLM=true`** → LLM proposes `argPatterns` on critical blocks

## Phase 3 — Fine-tuning (future)

```bash
pnpm ai:export-training-data --out=exports/training-dataset.jsonl
# Offline LoRA on qwen3:8b → register as mcp-guardian-threat:v1 in Ollama
```

Target: ≥500 labeled rows before fine-tune is worthwhile. Export excludes calibrator-seeded records.

## Auto Threat Research (adv corpus loop)

![Auto Threat Research Architecture](../docs/assets/auto-threat-research-architecture.png)

When enabled, detections automatically flow through LLM research → taxonomy classification → validated `adv-NNN.json` writes under `adversarial-harness/fixtures/custom-attacks/` — **no dashboard accept step**. Policy rules are **not** auto-applied; only harness fixtures grow.

When both `GUARDIAN_THREAT_RESEARCH_AUTO=true` and `SWARM_THREAT_RESEARCH_AUTO=true`, Threat Lab still writes `threat-lab-candidates.json` for **policy review** (pending/accept), and each validated discovery is written to `adv-*.json` via the **same** `writeAutoCorpusFixture` path as Auto Threat Research (no second LLM call, shared fingerprint dedupe). Legacy direct Threat Lab fixture writes are used only when those auto flags are off.

### Detection sources

| Source | Trigger | Env toggle |
|--------|---------|------------|
| High-confidence semantic flag | Async/local semantic audit after proxy traffic | `GUARDIAN_THREAT_RESEARCH_SEMANTIC` (default on) |
| Repeat policy blocks | Instant attack learning threshold hit | `GUARDIAN_THREAT_RESEARCH_BLOCKS` (default on) |
| New ThreatIntel entry | Live CVE/advisory poll | `GUARDIAN_THREAT_RESEARCH_THREAT_INTEL` (default on) |
| Swarm bypass | Batch swarm / analysis run | `SWARM_THREAT_RESEARCH_AUTO` |
| Corpus proactive seed | Batch proactive mode | `SWARM_THREAT_RESEARCH_PROACTIVE` (default on) |

### Quick start

```bash
# Runtime (proxy) — debounced queue on live traffic
export GUARDIAN_THREAT_RESEARCH_AUTO=true
export GUARDIAN_LLM_ENABLED=true
export OLLAMA_BASE_URL=http://localhost:11434

# Batch (swarm CI / analysis)
export SWARM_THREAT_RESEARCH_AUTO=true
pnpm security-swarm:auto-threat-research
# Or included in full swarm when SWARM_THREAT_RESEARCH_AUTO=true
pnpm security-swarm:analyze
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GUARDIAN_THREAT_RESEARCH_AUTO` | off | Master switch (runtime + batch) |
| `SWARM_THREAT_RESEARCH_AUTO` | off | Enable batch agent in swarm / analysis |
| `GUARDIAN_THREAT_RESEARCH_MIN_CONFIDENCE` | `0.85` | Min LLM/semantic confidence to auto-write |
| `GUARDIAN_THREAT_RESEARCH_SEMANTIC_MIN_CONFIDENCE` | `0.85` | Min async semantic flag confidence |
| `GUARDIAN_THREAT_RESEARCH_MAX_PER_HOUR` | `20` | Rate limit |
| `GUARDIAN_THREAT_RESEARCH_DEBOUNCE_MS` | `5000` | Runtime queue debounce |
| `GUARDIAN_THREAT_RESEARCH_SEMANTIC` | on | Auto-research high-confidence semantic flags |
| `GUARDIAN_THREAT_RESEARCH_BLOCKS` | on | Auto-research repeat policy blocks |
| `GUARDIAN_THREAT_RESEARCH_THREAT_INTEL` | on | Auto-research new CVE/advisories |
| `GUARDIAN_THREAT_RESEARCH_REQUIRE_REPLAY` | off | Fixture must be blocked by current policy before write |
| `SWARM_THREAT_RESEARCH_MAX` | `10` | Max events per batch run |
| `SWARM_THREAT_RESEARCH_PROACTIVE` | on | Include corpus-seeded proactive events in batch |

Reuse Threat Lab LLM settings: `SWARM_THREAT_LAB_LLM_TIMEOUT_MS`, `GUARDIAN_LLM_MODEL`, `OLLAMA_BASE_URL`.

### Safety gates (always on)

- JSON schema validation (`validateCorpusCandidateSchema`)
- Dangerous unblock regex rejection (`learning-quorum`)
- Fingerprint dedupe (`~/.mcp-guardian/threat-research-processed.json`)
- Hourly rate cap
- Reject `llm-fallback-*` attack classes
- Pro license gate (same as Threat Lab)

Optional stricter mode: `GUARDIAN_THREAT_RESEARCH_REQUIRE_REPLAY=true`.

### Outputs & audit

- `adversarial-harness/fixtures/custom-attacks/adv-NNN.json` — `source: "auto-threat-research"`
- `reports/security-swarm/auto-corpus-manifest.json` — timestamp, provenance, fingerprint, fixture path
- Dashboard **Swarm** tab → **Auto corpus additions** (read-only audit)

## Related docs

- [security-swarm/README.md](../security-swarm/README.md)
- [AI_LEARNING.md](./AI_LEARNING.md)
