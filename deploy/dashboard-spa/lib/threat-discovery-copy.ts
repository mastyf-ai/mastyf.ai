export const THREAT_DISCOVERY_EXPLAINERS: Record<string, string> = {
  pendingReview:
    'Policy rule review only — pending until you accept (YAML applied to live policy). With Autopilot, harness adv-*.json fixtures are written at discovery time via the auto-corpus path; pending does not mean the fixture is missing.',
  autoFixtures:
    'Harness fixtures written by Auto Threat Research (runtime, scheduler, or Threat Lab batch when both auto flags are on). Policy rules are never auto-applied — use Threat Lab accept for policy only.',
  llmStatus:
    'Threat Lab and Auto Research require a healthy local Ollama instance (GUARDIAN_LLM_ENABLED=true). No synthetic fallback candidates are emitted when LLM is offline.',
  queueDepth:
    'Runtime detections (semantic flags, repeat blocks, new CVEs) are debounced and queued before LLM research runs on live proxy traffic.',
  writesThisHour:
    'Auto corpus writes are capped per hour (GUARDIAN_THREAT_RESEARCH_MAX_PER_HOUR) to prevent runaway fixture generation.',
  processedFingerprints:
    'SHA-256 fingerprints of already-processed inputs — dedupe store prevents duplicate adv-*.json writes across runs.',
  threatLabEnabled:
    'When SWARM_THREAT_LAB=true, batch discovery runs during security analysis or via the Run Threat Lab button.',
  autoResearchEnabled:
    'When GUARDIAN_THREAT_RESEARCH_AUTO=true and SWARM_THREAT_RESEARCH_AUTO=true, validated discoveries auto-write adv fixtures.',
};

export type PipelineStage = {
  id: string;
  label: string;
  short: string;
  explanation: string;
  envVars?: string[];
  safetyGates?: string[];
};

export const THREAT_LAB_STAGES: PipelineStage[] = [
  {
    id: 'sources',
    label: 'Detection sources',
    short: 'Inputs',
    explanation:
      'Authentic inputs only: swarm bypasses, human-labeled semantic TPs, ThreatIntel CVE/advisories, and corpus attacks (proactive mode). Calibrator seeds are excluded.',
    envVars: ['SWARM_THREAT_LAB_SEMANTIC', 'SWARM_THREAT_LAB_THREAT_INTEL', 'SWARM_THREAT_LAB_MODE'],
  },
  {
    id: 'llm',
    label: 'Ollama LLM',
    short: 'Discover',
    explanation:
      'Local LLM proposes attack class, hypothesis, corpus fixture, and optional YAML policy rule. Requires Ollama — no deterministic fallback.',
    envVars: ['GUARDIAN_LLM_ENABLED', 'OLLAMA_BASE_URL', 'GUARDIAN_LLM_MODEL'],
  },
  {
    id: 'validate',
    label: 'Validation gates',
    short: 'Validate',
    explanation:
      'JSON schema validation, dangerous-regex rejection, optional replay block test, and fingerprint dedupe before any write.',
    safetyGates: ['validateCorpusCandidateSchema', 'learning-quorum regex check', 'fingerprint dedupe'],
  },
  {
    id: 'manifest',
    label: 'Candidate manifest',
    short: 'Manifest',
    explanation:
      'Signed threat-lab-candidates.json with provenance. When Autopilot auto flags are on, validated discoveries also write adv-*.json via the auto-corpus writer (same path as Auto Research).',
  },
  {
    id: 'accept',
    label: 'Human accept',
    short: 'Review',
    explanation:
      'Accept applies policyRule to live policy via policy-applier. Reject marks the candidate rejected. Harness fixtures are not created or removed by accept — they are written at discovery when auto-corpus is enabled.',
  },
];

export const AUTO_RESEARCH_STAGES: PipelineStage[] = [
  {
    id: 'detect',
    label: 'Live detections',
    short: 'Detect',
    explanation:
      'Semantic flags, repeat policy blocks, new ThreatIntel entries, swarm bypasses, and corpus proactive seeds enqueue research events.',
    envVars: [
      'GUARDIAN_THREAT_RESEARCH_SEMANTIC',
      'GUARDIAN_THREAT_RESEARCH_BLOCKS',
      'GUARDIAN_THREAT_RESEARCH_THREAT_INTEL',
    ],
  },
  {
    id: 'queue',
    label: 'Debounced queue',
    short: 'Queue',
    explanation:
      'Events debounce (GUARDIAN_THREAT_RESEARCH_DEBOUNCE_MS) and respect hourly rate cap. Duplicate fingerprints are skipped.',
    envVars: ['GUARDIAN_THREAT_RESEARCH_DEBOUNCE_MS', 'GUARDIAN_THREAT_RESEARCH_MAX_PER_HOUR'],
  },
  {
    id: 'llm',
    label: 'LLM research',
    short: 'Research',
    explanation:
      'Same Threat Lab LLM path discovers attack class and corpus fixture. Minimum confidence gate (default 0.85) filters low-quality output.',
    envVars: ['GUARDIAN_THREAT_RESEARCH_MIN_CONFIDENCE'],
  },
  {
    id: 'taxonomy',
    label: 'Taxonomy classify',
    short: 'Classify',
    explanation:
      'attackClassFromBlockRule and normalizeDiscoveryClassification map discoveries to corpus categories before write.',
  },
  {
    id: 'write',
    label: 'adv fixture write',
    short: 'Write',
    explanation:
      'Validated adv-NNN.json under adversarial-harness/fixtures/custom-attacks with source: auto-threat-research. Manifest audit only — no policy auto-apply.',
    safetyGates: ['rate cap', 'dedupe store', 'reject llm-fallback-* classes'],
  },
];

export const SOURCE_LABELS: Record<string, string> = {
  semantic_flag: 'Semantic flag',
  block_repeat: 'Block repeat',
  threat_intel: 'Threat intel',
  bypass: 'Swarm bypass',
  corpus_proactive: 'Corpus proactive',
  'threat-intel': 'Threat intel',
  'semantic-tp': 'Semantic TP',
  'corpus-proactive': 'Corpus proactive',
  unknown: 'Unknown',
};
