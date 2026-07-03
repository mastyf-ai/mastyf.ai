export type ArchNodeGroup = 'ci' | 'runtime' | 'external' | 'threat' | 'human' | 'output' | 'research' | 'fabric';

export type ArchNode = {
  id: string;
  label: string;
  short: string;
  description: string;
  x: number;
  y: number;
  group: ArchNodeGroup;
};

export type ArchEdge = {
  from: string;
  to: string;
  label?: string;
  loop?: boolean;
  animated?: boolean;
};

export type ArchitectureGraph = {
  id: string;
  title: string;
  subtitle: string;
  staticImage: string;
  staticImageAlt: string;
  viewBox: string;
  nodes: ArchNode[];
  edges: ArchEdge[];
  flowOrder: string[];
};

const SWARM_NODES: ArchNode[] = [
  {
    id: 'ai-clients',
    label: 'AI Clients',
    short: 'Clients',
    description: 'Cursor, Claude Desktop, Cline — every tool call flows through the proxy.',
    x: 80,
    y: 200,
    group: 'external',
  },
  {
    id: 'scout',
    label: 'Scout Agent',
    short: 'Scout',
    description: 'SAST scan, dependency audit, and config review on every PR.',
    x: 120,
    y: 60,
    group: 'ci',
  },
  {
    id: 'corpus',
    label: 'Corpus Agent',
    short: 'Corpus',
    description: 'Evaluates all 228 attack fixtures against current policy — 228/228 gates.',
    x: 240,
    y: 60,
    group: 'ci',
  },
  {
    id: 'evasion',
    label: 'Evasion Agent',
    short: 'Evasion',
    description: '120+ bypass probes plus LLM-generated novel attacks.',
    x: 360,
    y: 60,
    group: 'ci',
  },
  {
    id: 'parity',
    label: 'Parity Agent',
    short: 'Parity',
    description: 'Verifies Node and Python implementations produce identical decisions.',
    x: 480,
    y: 60,
    group: 'ci',
  },
  {
    id: 'proxy-agent',
    label: 'Proxy Agent',
    short: 'Proxy',
    description: 'Live stdio MCP session tests against a running proxy instance.',
    x: 600,
    y: 60,
    group: 'ci',
  },
  {
    id: 'report',
    label: 'Report Agent',
    short: 'Report',
    description: 'Writes security-swarm/latest.json with full results and metrics.',
    x: 720,
    y: 60,
    group: 'ci',
  },
  {
    id: 'blockguard',
    label: 'BlockGuard',
    short: 'BlockGuard',
    description: 'Enforces active policy synchronously on every tool call. Fail-closed.',
    x: 280,
    y: 200,
    group: 'runtime',
  },
  {
    id: 'instant-learner',
    label: 'InstantLearner',
    short: 'Instant',
    description: 'Tracks per-block statistics and surfaces rule suggestions in real time.',
    x: 420,
    y: 200,
    group: 'runtime',
  },
  {
    id: 'semantic-auditor',
    label: 'SemanticAuditor',
    short: 'Semantic',
    description: 'Optional async LLM review for calls that clear pattern checks but look suspicious.',
    x: 420,
    y: 280,
    group: 'runtime',
  },
  {
    id: 'pattern-synth',
    label: 'PatternSynthesizer',
    short: 'Synthesizer',
    description: 'Batches suggestions from InstantLearner and SemanticAuditor into candidate rules.',
    x: 560,
    y: 240,
    group: 'runtime',
  },
  {
    id: 'calibrator',
    label: 'Calibrator',
    short: 'Calibrator',
    description: 'Labels candidates, tunes thresholds, promotes approved rules back to BlockGuard.',
    x: 700,
    y: 240,
    group: 'runtime',
  },
  {
    id: 'mcp-tools',
    label: 'MCP Tools',
    short: 'Tools',
    description: 'Filesystem, GitHub, databases, APIs — allowed calls reach upstream servers.',
    x: 160,
    y: 320,
    group: 'external',
  },
];

const SWARM_EDGES: ArchEdge[] = [
  { from: 'scout', to: 'corpus', animated: true },
  { from: 'corpus', to: 'evasion', animated: true },
  { from: 'evasion', to: 'parity', animated: true },
  { from: 'parity', to: 'proxy-agent', animated: true },
  { from: 'proxy-agent', to: 'report', animated: true },
  { from: 'ai-clients', to: 'blockguard', animated: true },
  { from: 'blockguard', to: 'mcp-tools', animated: true },
  { from: 'blockguard', to: 'instant-learner', animated: true },
  { from: 'blockguard', to: 'semantic-auditor', animated: true },
  { from: 'instant-learner', to: 'pattern-synth', animated: true },
  { from: 'semantic-auditor', to: 'pattern-synth', animated: true },
  { from: 'pattern-synth', to: 'calibrator', animated: true },
  { from: 'report', to: 'corpus', label: 'Loop A', loop: true, animated: true },
  { from: 'calibrator', to: 'blockguard', label: 'Loop B', loop: true, animated: true },
  { from: 'calibrator', to: 'semantic-auditor', label: 'Loop C', loop: true, animated: true },
  { from: 'report', to: 'calibrator', label: 'Loop D', loop: true, animated: true },
];

const THREAT_LAB_NODES: ArchNode[] = [
  {
    id: 'sources',
    label: 'Discovery Inputs',
    short: 'Inputs',
    description: 'Swarm bypasses, semantic audit store, ThreatIntel feeds, and live MCP traffic.',
    x: 100,
    y: 120,
    group: 'threat',
  },
  {
    id: 'propose',
    label: 'Propose',
    short: 'Propose',
    description: 'Local Ollama LLM generates attackClass, corpusCandidate JSON, and policyRule YAML.',
    x: 280,
    y: 120,
    group: 'threat',
  },
  {
    id: 'validate',
    label: 'Validate',
    short: 'Validate',
    description: 'Schema check, harness replay, and quorum safety before queuing.',
    x: 420,
    y: 120,
    group: 'threat',
  },
  {
    id: 'queue',
    label: 'Queue',
    short: 'Queue',
    description: 'HMAC-signed threat-lab-candidates.json awaits human review.',
    x: 560,
    y: 120,
    group: 'threat',
  },
  {
    id: 'human',
    label: 'Human in the Loop',
    short: 'Review',
    description: 'Dashboard review, PR review via open-corpus-pr, accept/reject suggestions.',
    x: 700,
    y: 120,
    group: 'human',
  },
  {
    id: 'corpus-out',
    label: 'Attack Corpus',
    short: 'Corpus',
    description: 'corpus/attacks + adv-NNN fixtures feed regression testing.',
    x: 200,
    y: 260,
    group: 'output',
  },
  {
    id: 'policy-out',
    label: 'Live Policy',
    short: 'Policy',
    description: 'default-policy.yaml applied via policy-applier after human approval.',
    x: 400,
    y: 260,
    group: 'output',
  },
  {
    id: 'calibration-out',
    label: 'Calibration',
    short: 'Calibrate',
    description: 'Thresholds and pattern proposals tune detection layers.',
    x: 600,
    y: 260,
    group: 'output',
  },
];

const THREAT_LAB_EDGES: ArchEdge[] = [
  { from: 'sources', to: 'propose', animated: true },
  { from: 'propose', to: 'validate', animated: true },
  { from: 'validate', to: 'queue', animated: true },
  { from: 'queue', to: 'human', animated: true },
  { from: 'human', to: 'corpus-out', animated: true },
  { from: 'human', to: 'policy-out', animated: true },
  { from: 'human', to: 'calibration-out', animated: true },
  { from: 'corpus-out', to: 'propose', label: 'Loop A', loop: true, animated: true },
  { from: 'policy-out', to: 'validate', label: 'Loop B', loop: true, animated: true },
  { from: 'calibration-out', to: 'propose', label: 'Loop C', loop: true, animated: true },
];

const AUTO_RESEARCH_NODES: ArchNode[] = [
  {
    id: 'detect',
    label: 'Live Detections',
    short: 'Detect',
    description: 'Semantic flags, repeat blocks, ThreatIntel, swarm bypasses, and corpus seeds.',
    x: 120,
    y: 140,
    group: 'research',
  },
  {
    id: 'queue-ar',
    label: 'Debounced Queue',
    short: 'Queue',
    description: 'Debounced events with hourly rate cap. Duplicate fingerprints skipped.',
    x: 280,
    y: 140,
    group: 'research',
  },
  {
    id: 'llm-ar',
    label: 'LLM Research',
    short: 'Research',
    description: 'Same Threat Lab LLM path with minimum confidence gate (default 0.85).',
    x: 440,
    y: 140,
    group: 'research',
  },
  {
    id: 'taxonomy',
    label: 'Taxonomy Classify',
    short: 'Classify',
    description: 'Map discoveries to corpus categories before write.',
    x: 600,
    y: 140,
    group: 'research',
  },
  {
    id: 'write',
    label: 'adv Fixture Write',
    short: 'Write',
    description: 'Validated adv-*.json under adversarial-harness — audit only, no auto-apply.',
    x: 760,
    y: 140,
    group: 'research',
  },
];

const AUTO_RESEARCH_EDGES: ArchEdge[] = [
  { from: 'detect', to: 'queue-ar', animated: true },
  { from: 'queue-ar', to: 'llm-ar', animated: true },
  { from: 'llm-ar', to: 'taxonomy', animated: true },
  { from: 'taxonomy', to: 'write', animated: true },
  { from: 'write', to: 'detect', label: 'Feedback', loop: true, animated: true },
];

const DEFENSE_FABRIC_NODES: ArchNode[] = [
  {
    id: 'ingress',
    label: 'Ingress',
    short: 'Phase 1',
    description: 'TLS, OAuth/DPoP, JSON-RPC validation, body/field limits, and ingress rate limits on every transport.',
    x: 60,
    y: 100,
    group: 'fabric',
  },
  {
    id: 'economics',
    label: 'Economics',
    short: 'Phase 2',
    description: 'Unified spend pool (tokens/min, USD/min, daily) with loop anomaly guard before policy evaluation.',
    x: 200,
    y: 100,
    group: 'fabric',
  },
  {
    id: 'policy',
    label: 'Policy',
    short: 'Phase 3',
    description: 'YAML/OPA/RBAC, session flow, CVE gate, and certification checks — your rules enforced synchronously.',
    x: 340,
    y: 100,
    group: 'fabric',
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    short: 'Phase 4',
    description: 'Argument scan, sync semantic gate, and async semantic audit for borderline tool calls.',
    x: 480,
    y: 100,
    group: 'fabric',
  },
  {
    id: 'upstream',
    label: 'Upstream',
    short: 'Phase 5',
    description: 'Trace propagation to upstream MCP servers with streaming spend cutoff before execution.',
    x: 620,
    y: 100,
    group: 'fabric',
  },
  {
    id: 'egress',
    label: 'Egress',
    short: 'Phase 6',
    description: 'Response DLP, rug-pull fingerprint, spend commit, and full audit trail on every response.',
    x: 760,
    y: 100,
    group: 'fabric',
  },
];

const DEFENSE_FABRIC_EDGES: ArchEdge[] = [
  { from: 'ingress', to: 'economics', animated: true },
  { from: 'economics', to: 'policy', animated: true },
  { from: 'policy', to: 'intelligence', animated: true },
  { from: 'intelligence', to: 'upstream', animated: true },
  { from: 'upstream', to: 'egress', animated: true },
];

export const ARCHITECTURE_GRAPHS: ArchitectureGraph[] = [
  {
    id: 'swarm',
    title: 'Security Swarm',
    subtitle: 'CI validation and runtime learning — four feedback loops that compound with every attack.',
    staticImage: '/assets/security-swarm-architecture.png',
    staticImageAlt: 'mastyf.ai Security Swarm architecture diagram',
    viewBox: '0 0 820 360',
    nodes: SWARM_NODES,
    edges: SWARM_EDGES,
    flowOrder: [
      'scout',
      'corpus',
      'evasion',
      'parity',
      'proxy-agent',
      'report',
      'ai-clients',
      'blockguard',
      'instant-learner',
      'semantic-auditor',
      'pattern-synth',
      'calibrator',
      'mcp-tools',
    ],
  },
  {
    id: 'threat-lab',
    title: 'LLM Threat Discovery',
    subtitle: 'Human-in-the-loop discovery — LLM proposes, you approve before policy changes.',
    staticImage: '/assets/llm-threat-discovery-architecture.png',
    staticImageAlt: 'mastyf.ai LLM Threat Discovery architecture diagram',
    viewBox: '0 0 820 340',
    nodes: THREAT_LAB_NODES,
    edges: THREAT_LAB_EDGES,
    flowOrder: ['sources', 'propose', 'validate', 'queue', 'human', 'corpus-out', 'policy-out', 'calibration-out'],
  },
  {
    id: 'auto-research',
    title: 'Auto Threat Research',
    subtitle: 'Continuous red-team loop — live proxy traffic feeds new adversarial fixtures 24/7.',
    staticImage: '/assets/auto-threat-research-architecture.png',
    staticImageAlt: 'mastyf.ai Auto Threat Research architecture diagram',
    viewBox: '0 0 880 220',
    nodes: AUTO_RESEARCH_NODES,
    edges: AUTO_RESEARCH_EDGES,
    flowOrder: ['detect', 'queue-ar', 'llm-ar', 'taxonomy', 'write'],
  },
  {
    id: 'defense-fabric',
    title: 'Defense Fabric',
    subtitle: 'Six phases on every tools/call — ingress through egress on stdio, HTTP, SSE, streamable HTTP, and WebSocket.',
    staticImage: '/assets/security-swarm-architecture.png',
    staticImageAlt: 'mastyf.ai Defense Fabric six-phase model',
    viewBox: '0 0 880 200',
    nodes: DEFENSE_FABRIC_NODES,
    edges: DEFENSE_FABRIC_EDGES,
    flowOrder: ['ingress', 'economics', 'policy', 'intelligence', 'upstream', 'egress'],
  },
];

export function getGraph(id: string): ArchitectureGraph {
  return ARCHITECTURE_GRAPHS.find((g) => g.id === id) ?? ARCHITECTURE_GRAPHS[0];
}

export function getConnectedEdgeIds(
  graph: ArchitectureGraph,
  nodeId: string,
): Set<string> {
  const ids = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.from === nodeId || edge.to === nodeId) {
      ids.add(`${edge.from}-${edge.to}`);
    }
  }
  return ids;
}
