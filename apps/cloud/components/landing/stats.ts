import { SITE_NAME } from '@/lib/product-links';

export const HERO_HEADLINE = {
  line1: 'Perimeter security',
  line2: 'for your AI.',
} as const;

export const HERO_LEAD =
  'Runtime enforcement, policy control, and trust scores for every MCP tool call. mastyf.ai intercepts agent actions, blocks violations before they execute, and scores npm packages so teams ship without guessing.';

export const HERO_VALUE_PILLARS = [
  {
    id: 'runtime',
    title: 'Runtime enforcement',
    body: 'BlockGuard intercepts every tools/call before it reaches your infrastructure — fail-closed by default.',
  },
  {
    id: 'trust',
    title: 'Package trust scores',
    body: 'Instant 0–100 scores and public badges for any npm MCP package — no account required.',
  },
  {
    id: 'control',
    title: 'Cloud control plane',
    body: 'Policy, fleet, keys, and evidence from one console — open source and self-hostable.',
  },
] as const;

export const HERO_TRUST_ITEMS = [
  { label: 'Open source', href: 'https://github.com/mastyf-ai/mastyf.ai' },
  { label: '228/228 corpus gates', href: 'https://github.com/mastyf-ai/mastyf.ai#security-swarm' },
  { label: 'Security Swarm', href: '#architecture' },
  { label: 'Public trust badges', href: '/certified' },
] as const;

/** Interactive showcase tabs — real product surfaces from the repo. */
export const SHOWCASE_TABS = [
  {
    id: 'enforcement',
    label: 'Runtime proxy',
    title: 'Every tool call inspected before it runs',
    body: 'mastyf.ai sits between your AI client and MCP servers. BlockGuard enforces policy synchronously on every call — prompt injection, path traversal, secret exfiltration, and shell commands are stopped before they reach your infrastructure.',
    bullets: ['Three-layer detection: regex, schema, semantic LLM', 'Fail-closed — blocked calls never execute', 'Full audit trail with allow/block status'],
    image: '/assets/showcase/enforcement.png',
    imageAlt: 'mastyf.ai runtime proxy blocking malicious tool calls',
    href: 'https://github.com/mastyf-ai/mastyf.ai#how-enforcement-works',
    cta: 'See enforcement docs',
    external: true,
    demo: 'enforcement' as const,
  },
  {
    id: 'dashboard',
    label: 'Ops dashboard',
    title: 'Full visibility into every agent action',
    body: 'The local ops dashboard shows block rates, live threat feeds, every tool call with full arguments, and cost estimates per call. Protection, Activity, Policy, Threat Lab, and Cost — all in one place.',
    bullets: ['Live threat feed and top triggered rules', 'Activity log with full tool arguments', 'Threat Lab for human-reviewed attack suggestions'],
    image: '/assets/showcase/dashboard.png',
    imageAlt: 'mastyf.ai ops dashboard with protection and activity views',
    href: 'https://github.com/mastyf-ai/mastyf.ai#dashboard',
    cta: 'Explore dashboard',
    external: true,
  },
  {
    id: 'policy',
    label: 'Policy engine',
    title: 'Your rules. Enforced in real time.',
    body: 'Define allow/block rules in YAML with hot-reload. Roll out safely with audit, warn, and block modes. Pre-built templates for HIPAA, PCI-DSS, GxP, and data residency ship in the repo.',
    bullets: ['Live YAML editor with hot-reload', 'audit → warn → block rollout modes', 'Compliance templates in policy-templates/'],
    image: '/assets/showcase/policy.png',
    imageAlt: 'mastyf.ai policy editor with YAML rules',
    href: 'https://github.com/mastyf-ai/mastyf.ai#policy',
    cta: 'View policy docs',
    external: true,
    demo: 'policy' as const,
  },
  {
    id: 'scores',
    label: 'Trust scores',
    title: 'Instant 0–100 scores for any npm MCP package',
    body: 'Look up any npm MCP package for an instant trust score with CVE checks, supply-chain signals, and registry metadata. Embed live SVG badges in your README — no account required.',
    bullets: ['Static analysis runs instantly', 'Optional deep scan with live MCP probe', 'Public badge pages for README embeds'],
    image: '/assets/showcase/trust-scores.png',
    imageAlt: 'mastyf.ai npm package trust score lookup',
    href: '/certified',
    cta: 'Look up a package',
    external: false,
    demo: 'score' as const,
  },
  {
    id: 'economics',
    label: 'Cost guard',
    title: 'Economics controls that stop runaway agents',
    body: 'Unified spend pools cap tokens and USD per minute. Loop anomaly guards halt recursive tool chains before they burn budgets — part of the six-phase Defense Fabric.',
    bullets: ['Token and USD per-minute caps', 'Loop anomaly detection and halt', 'Streaming spend cutoff on upstream calls'],
    image: '/assets/showcase/dashboard.png',
    imageAlt: 'mastyf.ai spend pool and economics controls',
    href: 'https://github.com/mastyf-ai/mastyf.ai/blob/main/docs/DEFENSE_FABRIC.md',
    cta: 'Defense Fabric docs',
    external: true,
    demo: 'cost' as const,
  },
] as const;

export const REPO_STORIES = [
  {
    id: 'fleet',
    label: 'Fleet Hub',
    title: 'Multi-server MCP protection at scale',
    body: 'Auto-discover MCP servers across your org, patch IDE configs, and enforce policy fleet-wide from the cloud console. One control plane for every agent endpoint.',
    bullets: ['Auto-discovery of MCP endpoints', 'IDE config patching (Cursor, Claude Desktop)', 'Centralized policy rollout'],
    href: 'https://github.com/mastyf-ai/mastyf.ai/blob/main/docs/REAL_WORLD_INTEGRATION.md',
  },
  {
    id: 'swarm',
    label: 'Security Swarm',
    title: 'CI + runtime closed loop',
    body: 'Four feedback loops connect CI red-teaming with runtime learning. Every bypass flows back into the 228-fixture corpus permanently.',
    bullets: ['228/228 corpus gates on every PR', 'Runtime InstantLearner from live blocks', 'Parity across Node and Python'],
    href: '#architecture',
  },
  {
    id: 'threat-lab',
    label: 'Threat Lab',
    title: 'Human-reviewed attack discovery',
    body: 'LLM proposes novel attacks; security teams approve before policy changes. No auto-apply — every discovery is auditable.',
    bullets: ['LLM-assisted attack proposals', 'Human approval queue', 'Corpus and policy feedback'],
    href: '#architecture',
  },
  {
    id: 'evidence',
    label: 'Evidence Pack',
    title: 'Compliance automation for security review',
    body: 'Generate enterprise evidence packs with OWASP mapping, corpus parity reports, and deployment maturity checks — ready for security review.',
    bullets: ['Automated evidence generation', 'OWASP attack matrix mapping', 'pnpm enterprise:evidence-check'],
    href: 'https://github.com/mastyf-ai/mastyf.ai/blob/main/docs/ENTERPRISE_EVIDENCE_PACK.md',
  },
  {
    id: 'economics',
    label: 'Economics',
    title: 'Spend pools and loop controls',
    body: 'Phase 2 of the Defense Fabric — unified token/USD caps, loop anomaly guards, and streaming spend cutoff before upstream calls execute.',
    bullets: ['MASTYF_AI_TENANT_TOKENS_PER_MIN', 'Loop anomaly halt', 'Daily spend pool enforcement'],
    href: 'https://github.com/mastyf-ai/mastyf.ai/blob/main/docs/DEFENSE_FABRIC.md',
  },
] as const;

export const DEFENSE_FABRIC_COPY = {
  headline: 'Defense Fabric — six phases on every tool call',
  body: 'Holistic MCP protection across ingress, economics, policy, intelligence, upstream, and egress. Every tools/call on all transports flows through the defense orchestrator.',
} as const;

/** Four capability pillars — Arcade-style grid. */
export const CAPABILITIES = [
  {
    id: 'runtime',
    label: 'Runtime',
    title: 'Enforce on every call',
    body: 'BlockGuard sits in the MCP path and stops violations before execution. Pattern detection runs in microseconds; semantic LLM audit catches borderline cases async.',
  },
  {
    id: 'policy',
    label: 'Policy',
    title: 'Rules you own',
    body: 'YAML policy with hot-reload, three rollout modes, and compliance templates. Edit in the dashboard or cloud console — changes apply immediately.',
  },
  {
    id: 'visibility',
    label: 'Visibility',
    title: 'See everything',
    body: 'Trust scores for npm packages, live badges, fleet threat graphs, and a full activity log. Security teams get signal without reading raw logs.',
  },
  {
    id: 'learning',
    label: 'Learning',
    title: 'Gets harder to bypass',
    body: 'CI Swarm red-teams your policy on every PR. Runtime Swarm learns from live blocks. Four feedback loops compound with every attack.',
  },
] as const;

export const THREATS_STOPPED = [
  { name: 'Prompt injection', detail: 'Malicious instructions embedded in tool arguments' },
  { name: 'Path traversal', detail: '/etc/passwd, .ssh/id_rsa, .aws/credentials' },
  { name: 'Secret exfiltration', detail: 'API keys and tokens leaking through arguments' },
  { name: 'Shell injection', detail: 'Reverse shells, rm -rf, encoded PowerShell' },
  { name: 'Data exfiltration', detail: 'Bulk SQL dumps, git push, unauthorized transfers' },
  { name: 'SSRF', detail: 'Metadata endpoints, localhost, private IP ranges' },
  { name: 'Encoding evasion', detail: 'Base64 blobs and Unicode homoglyphs' },
  { name: 'Cost abuse', detail: 'Runaway agent loops burning token budgets' },
  { name: 'Rug-pull attacks', detail: 'Tool definitions that change mid-session' },
] as const;

export const HOW_IT_WORKS = [
  {
    step: '1',
    title: 'Deploy the proxy',
    body: 'Run mastyf.ai between your AI client and MCP servers — Docker, source build, or connect to the cloud console. Every tool call flows through BlockGuard.',
  },
  {
    step: '2',
    title: 'Define your policy',
    body: 'Start in audit mode to see what your agents do. Tune rules in YAML, then switch to block mode for production enforcement.',
  },
  {
    step: '3',
    title: 'Score, badge, and ship',
    body: 'Look up npm MCP packages for trust scores, embed badges in READMEs, and let the Security Swarm keep learning from every block.',
  },
] as const;

export const PROBLEM_CARDS = [
  {
    title: 'No perimeter',
    body: 'AI agents read files, push code, and query databases autonomously — with no enforcement layer between the agent and your infrastructure.',
    icon: 'eye' as const,
  },
  {
    title: 'No audit trail',
    body: 'When something goes wrong, teams cannot answer what action the agent took, on behalf of which user, in which system.',
    icon: 'shield' as const,
  },
  {
    title: 'No trust signal',
    body: 'Teams have no simple way to verify which MCP packages are safe before agents connect to production data.',
    icon: 'badge' as const,
  },
] as const;

export const HERO_STATS = [
  { value: '228/228', label: 'Corpus gates', detail: '0 bypasses · 100% parity' },
  { value: '3-layer', label: 'Detection', detail: 'Regex · schema · semantic LLM' },
  { value: '0–100', label: 'Trust scores', detail: 'Instant npm MCP lookup' },
  { value: 'Free', label: 'Cloud console', detail: 'Policy · keys · fleet' },
] as const;

export const SWARM_AGENTS = [
  { name: 'Scout', track: 'CI', role: 'SAST, dependency audit, config review' },
  { name: 'Corpus', track: 'CI', role: '228 attack fixtures against current policy' },
  { name: 'Evasion', track: 'CI', role: '120+ bypass probes + LLM-generated new ones' },
  { name: 'Parity', track: 'CI', role: 'Node vs Python identical decisions' },
  { name: 'BlockGuard', track: 'Runtime', role: 'Sync policy enforcement on every call' },
  { name: 'InstantLearner', track: 'Runtime', role: 'Per-block stats → rule suggestions' },
  { name: 'SemanticAuditor', track: 'Runtime', role: 'Async LLM review for borderline calls' },
  { name: 'Calibrator', track: 'Runtime', role: 'Threshold tuning from labeled outcomes' },
] as const;

export const DETECTION_LAYERS = [
  {
    title: 'Pattern detection',
    body: 'Regex scanning for injection, dangerous paths, leaked secrets, shell commands, and encoding tricks. Microseconds, no external deps.',
  },
  {
    title: 'Schema validation',
    body: 'Rejects malformed payloads, oversized arguments, and JSON-RPC violations before policy evaluation.',
  },
  {
    title: 'Semantic review',
    body: 'Optional local LLM (Ollama) or cloud model for borderline calls. Falls back to heuristics if no model is configured.',
  },
] as const;

export const SECURITY_SWARM_COPY = {
  headline: 'A Security Swarm that compounds with every attack',
  body: 'CI Swarm attacks your policy on every PR and nightly. Runtime Swarm enforces and learns from every live block. Four feedback loops connect them — bypasses flow back into the corpus permanently.',
} as const;

export { SITE_NAME };
