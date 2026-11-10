import { DEVELOPER_OFFER_PLACES, formatPlanPrice } from '@/lib/billing/plans';
import { SHIELD_PLATFORM_ORDER, SHIELD_PLATFORMS, shieldPlatformAvailable } from '@/lib/billing/shield-builds';
import { SITE_NAME, ZENODO_DOI } from '@/lib/product-links';

export const HERO_HEADLINE = {
  line1: 'Your AI can reason.',
  line2: 'Mastyf controls what it can execute.',
} as const;

export const HERO_LEAD =
  'Mastyf is an AI agent security platform that enforces policy at the execution boundary — combining runtime authorization, continuous adversarial testing, MCP supply-chain trust, and centralized enterprise fleet governance. The model is not the security boundary: the agent proposes, Mastyf authorizes, and infrastructure executes.';

export const HERO_VALUE_PILLARS = [
  {
    id: 'reason-vs-execute',
    title: 'The model is not the security boundary',
    body: 'Autoregressive Transformer text output cannot synthesize execution authority across arbitrary tool chains.',
  },
  {
    id: 'runtime-authorization',
    title: 'The agent proposes. Mastyf authorizes.',
    body: 'Every tool invocation is intercepted and validated against capability scopes, schemas, and relational invariants before dispatch.',
  },
  {
    id: 'complete-mediation',
    title: 'Non-ALLOW → zero backend execution',
    body: 'Complete mediation guarantees that any blocked or uncertain action results in zero backend bytes transmitted to tools.',
  },
] as const;

export const HERO_TRUST_ITEMS = [
  { label: `Paper DOI: ${ZENODO_DOI}`, href: `https://doi.org/${ZENODO_DOI}` },
  { label: 'Mastyf Guard 1.5B (Frozen V6 Checkpoint)', href: 'https://huggingface.co/Rudraneel93/mastyf-guard-1.5b-v2-boundary-sharpened' },
  { label: '99.52% attack defense on AgentDojo (utility parity)', href: '#evaluation' },
  { label: 'Complete mediation: 0 backend bytes on block', href: '#architecture' },
] as const;

export const HERO_STATS = [
  {
    value: '99.52%',
    label: 'AgentDojo defense',
    detail: '629 interactive episodes · exact clean task utility parity (6/97 matching unprotected baseline)',
  },
  {
    value: '98.43%',
    label: 'InjecAgent defense',
    detail: '4,216 benchmark instances · 267.7ms P50 latency on commodity CPU',
  },
  {
    value: '< 4.8µs',
    label: 'Deterministic CBAC',
    detail: '>330,000 req/s fast-path reference monitor throughput',
  },
  {
    value: '0 bytes',
    label: 'Backend transmission',
    detail: 'Strict transport isolation on BLOCK or ESCALATE decisions',
  },
] as const;

/** Product Family Definitions */
export const PRODUCT_FAMILY = [
  {
    id: 'shield',
    name: 'Mastyf Shield',
    tagline: 'Fail-closed execution appliance',
    category: 'Reference Monitor & Protection Appliance',
    description:
      'The fail-closed protection appliance and reference monitor for AI agents & MCP tools. Sits directly on the transport wire between untrusted agent cognition and privileged execution. Enforces DIFC taint tracking, CBAC capability envelopes, and the mathematical invariant: BackendExecution > 0 ==> Decision == ALLOW (0 backend bytes on non-allow).',
    bullets: [
      'Packaged macOS & Linux desktop appliance for local agents (Claude Desktop, Cursor)',
      'High-throughput Kubernetes & cloud sidecar (>330,000 req/s fast path)',
      'Dynamic Information Flow Control (DIFC) session taint tracking',
      'Ed25519 / SHA-256 tamper-evident cryptographic execution ledger',
    ],
    href: '/#shield',
    badge: 'Flagship Appliance',
  },
  {
    id: 'gateway',
    name: 'Mastyf Gateway',
    tagline: 'Control execution',
    category: 'Runtime Execution Security',
    description:
      'The execution enforcement layer. Intercepts agent tool calls and applies deterministic capability-based access control (CBAC), relational invariants, and workflow state validation before privileged execution. Fail-closed: non-allow produces 0 backend bytes.',
    bullets: [
      'Microsecond deterministic capability authorization (< 4.8 µs)',
      'Four typed relational argument invariants (containment, scope, monotonicity, monetary clamping)',
      'Zero-byte wire isolation on non-ALLOW decisions',
      'Open-source AGPL-3.0 self-hostable core',
    ],
    href: '/developers',
    badge: 'Core Runtime',
  },
  {
    id: 'swarm',
    name: 'Mastyf Swarm',
    tagline: 'Attack continuously',
    category: 'Continuous Adversarial Security',
    description:
      'The adversarial testing and continuous hardening layer. Automates CI/CD red-teaming with multi-turn injection fixtures, mutation-based evasion probes, and a feedback loop from live production signals directly into your regression corpus.',
    bullets: [
      'CI/CD automated attack runner and regression gates',
      'Threat Lab mutation engine for novel multi-step attack synthesis',
      'Human-in-the-loop approval before policy updates',
      'Closed-loop feedback from runtime alerts into test fixtures',
    ],
    href: '/docs/how-it-works#components',
    badge: 'Adversarial CI',
  },
  {
    id: 'trust',
    name: 'Mastyf Trust',
    tagline: 'Know your tools',
    category: 'MCP & Supply-Chain Intelligence',
    description:
      'The software and MCP supply-chain risk intelligence layer. Evaluates Model Context Protocol servers, npm packages, and tool manifests for known CVEs, malicious author updates, and excessive ambient permissions.',
    bullets: [
      'Instant 0–100 static trust scoring for any MCP package',
      'Supply-chain CVE alerts and registry maintenance telemetry',
      'Static permission blast radius & dependency mapping',
      'Public badge generation for package READMEs',
    ],
    href: '/trust',
    badge: 'Supply Chain',
  },
  {
    id: 'control-plane',
    name: 'Mastyf Control Plane',
    tagline: 'Govern the fleet',
    category: 'Fleet Governance & Evidence',
    description:
      'Central governance, fleet management, evidence generation, and operations for enterprise agent fleets. Distribute policies across environments, maintain tamper-evident audit trails, and enforce human approval workflows.',
    bullets: [
      'Fleet-wide policy distribution and environment management',
      'Cryptographically verifiable execution receipts (Ed25519)',
      'Automated compliance evidence generation for OWASP Agentic Top 10 & NIST',
      'Enterprise SSO, granular RBAC, and SIEM streaming',
    ],
    href: '/pilot',
    badge: 'Enterprise Platform',
  },
  {
    id: 'guard',
    name: 'Mastyf Guard',
    tagline: 'Subordinate semantic auditor',
    category: 'Boundary-Sharpened SLM',
    description:
      'A fine-tuned 1.54B autoregressive Transformer decoder (V6 checkpoint) specifically trained with hard-negative contrastive gap parameters to audit in-scope relational parameter poisoning. Governed by the formal invariant: Afinal = Astruct ∩ Asemantic ⊆ Astruct — the learned model can revoke authority, but can never create authority.',
    bullets: [
      'Frozen V6 boundary-sharpened weights (Hugging Face d59a6aa)',
      'Subordinate to deterministic CBAC — cannot grant permissions',
      'Optimized for INT4 AWQ / GGUF CPU inference (267.7ms P50)',
      'Eliminates 94.7% of in-scope parameter poisoning false negatives',
    ],
    href: '/research',
    badge: 'Research Model',
  },
] as const;

/** Capability Matrix Comparing Mastyf with Competitors */
export const CAPABILITY_MATRIX = [
  { feature: 'Runtime tool execution mediation', mastyf: 'Yes (deterministic proxy)', microsoft: 'In-app hooks', noma: 'Network gateway', obsidian: 'Post-action audit', nightfall: 'DLP proxy' },
  { feature: 'Zero backend bytes on blocked actions', mastyf: 'Guaranteed (Axiom A1)', microsoft: 'No (framework bound)', noma: 'Varies', obsidian: 'No', nightfall: 'Yes (data plane)' },
  { feature: 'Capability-Based Access Control (CBAC)', mastyf: 'Yes (HMAC + Token Table)', microsoft: 'Partial (RBAC)', noma: 'Partial', obsidian: 'No', nightfall: 'No' },
  { feature: 'Relational parameter invariants', mastyf: 'Yes (4 typed invariants)', microsoft: 'No', noma: 'No', obsidian: 'No', nightfall: 'No' },
  { feature: 'Decentralized Info Flow (DIFC)', mastyf: 'Yes (taint propagation)', microsoft: 'No', noma: 'No', obsidian: 'No', nightfall: 'Pattern matching' },
  { feature: 'Workflow sequence & certainty constraints', mastyf: 'Yes (FSM state tracking)', microsoft: 'Partial', noma: 'No', obsidian: 'No', nightfall: 'No' },
  { feature: 'Subordinate learned semantic auditor', mastyf: 'Yes (Mastyf Guard 1.5B V6)', microsoft: 'LLM judge', noma: 'Cloud classifier', obsidian: 'Model guardrails', nightfall: 'Cloud detectors' },
  { feature: 'Continuous adversarial CI/CD (Swarm)', mastyf: 'Yes (Security Swarm)', microsoft: 'PyRIT (separate)', noma: 'Red-teaming service', obsidian: 'No', nightfall: 'No' },
  { feature: 'MCP package trust & risk scoring', mastyf: 'Yes (Mastyf Trust)', microsoft: 'Marketplace check', noma: 'Tool discovery', obsidian: 'Asset inventory', nightfall: 'No' },
  { feature: 'Open-source self-hostable core', mastyf: 'Yes (AGPL-3.0)', microsoft: 'Yes (MIT/Apache)', noma: 'No (SaaS only)', obsidian: 'No (SaaS only)', nightfall: 'No (SaaS only)' },
  { feature: 'Published research & formal proofs', mastyf: 'Yes (Theorems 1–3, Prop 1)', microsoft: 'Whitepapers', noma: 'Marketing docs', obsidian: 'Reports', nightfall: 'Docs' },
] as const;

/** Interactive showcase tabs — real product surfaces from the repo. */
export const SHOWCASE_TABS = [
  {
    id: 'enforcement',
    label: 'Runtime Gateway',
    title: 'Every tool call inspected before privileged dispatch',
    body: 'Mastyf Gateway sits between your AI client and connected tools (MCP, APIs, DB, Shell). Deterministic capability authorization, relational argument bounds, and taint tracking evaluate synchronously on every call — prompt injection, path traversal, and unauthorized exfiltration are stopped with zero backend bytes sent.',
    bullets: ['Deterministic microsecond capability checks', 'Fail-closed wire isolation on non-ALLOW', 'Full audit trail with Ed25519 signed receipts'],
    image: '/assets/showcase/enforcement.png',
    imageAlt: 'Mastyf Gateway runtime proxy blocking malicious tool calls',
    href: '/developers',
    cta: 'Explore Gateway Architecture',
    external: false,
    demo: 'enforcement' as const,
  },
  {
    id: 'swarm',
    label: 'Security Swarm',
    title: 'Continuous adversarial testing & regression feedback',
    body: 'Automate red-teaming in CI/CD. The Security Swarm fires hundreds of evasion probes and multi-turn injection fixtures against your policies. When an attack is flagged in production, Threat Lab generates targeted mutations for security team approval before updating regression fixtures.',
    bullets: ['Continuous CI/CD automated red-teaming', 'Threat Lab human-in-the-loop attack mutation', 'Runtime alerts automatically enrich regression fixtures'],
    image: '/assets/showcase/dashboard.png',
    imageAlt: 'Mastyf Security Swarm adversarial testing interface',
    href: '/docs/how-it-works#components',
    cta: 'See Swarm Hardening Loop',
    external: false,
    demo: 'cost' as const,
  },
  {
    id: 'policy',
    label: 'Policy Engine',
    title: 'Declarative policies enforced at the execution boundary',
    body: 'Define tool capability permissions, path containment envelopes, monetary caps, and workflow sequence constraints in YAML with live hot-reload. Roll out safely using the proven progression: Audit → Warn → Block.',
    bullets: ['Declarative YAML policy-as-code', 'Audit → Warn → Block phased rollout', 'Pre-built compliance packs for HIPAA, PCI, and SOC 2'],
    image: '/assets/showcase/policy.png',
    imageAlt: 'Mastyf policy editor with YAML rules and live evaluation',
    href: '/developers',
    cta: 'View Policy Documentation',
    external: false,
    demo: 'policy' as const,
  },
  {
    id: 'scores',
    label: 'Trust Scores',
    title: 'Instant 0–100 risk scores for any MCP package',
    body: 'Scan any npm MCP package or server manifest for CVE vulnerabilities, permission blast radius, supply-chain signals, and author maintenance cadence before connecting it to production infrastructure.',
    bullets: ['Instant static dependency & CVE scanning', 'Static permission blast radius breakdown', 'Embeddable dynamic badges for READMEs'],
    image: '/assets/showcase/trust-scores.png',
    imageAlt: 'Mastyf npm MCP package trust score lookup',
    href: '/certified',
    cta: 'Scan an MCP Package',
    external: false,
    demo: 'score' as const,
  },
] as const;

export const DEFENSE_FABRIC_COPY = {
  headline: 'The model is not the authority. Mastyf controls execution.',
  body: 'Mastyf does not attempt to make the LLM intrinsically benevolent. It assumes the model may be manipulated, confused, or operating on adversarial data — and establishes an externally enforced security perimeter between what the model proposes and what infrastructure executes.',
} as const;

export const THREATS_STOPPED = [
  { name: 'Indirect Prompt Injection', detail: 'Hidden adversarial instructions in untrusted third-party tool outputs' },
  { name: 'Confused Deputy Tool Misuse', detail: 'Agent manipulated into invoking privileged tools outside user intent' },
  { name: 'Arbitrary Path Traversal', detail: 'Access attempts targeting /etc/passwd, .ssh/id_rsa, or .env secrets' },
  { name: 'Command & Shell Injection', detail: 'Reverse shells, encoded PowerShell, and destructive terminal execution' },
  { name: 'Cross-Tool Data Exfiltration', detail: 'Tainted database reads routed to unauthorized HTTP egress endpoints' },
  { name: 'SSRF & Cloud Metadata Access', detail: 'Invocations targeting 169.254.169.254 or internal VPC endpoints' },
  { name: 'Financial & Volume Overruns', detail: 'Unbounded monetary payouts and runaway recursive execution loops' },
  { name: 'Workflow Desynchronization', detail: 'Execution of downstream dependent steps before required prerequisites confirm' },
] as const;

export const HOW_IT_WORKS = [
  {
    step: '1',
    title: 'Drop in Mastyf Gateway',
    body: 'Run Mastyf between your AI client and tools via Docker, binary, or Kubernetes sidecar. Start in Audit Mode to observe tool activity with zero workflow disruption.',
  },
  {
    step: '2',
    title: 'Define Execution Policies',
    body: 'Translate discovered agent interactions into declarative YAML policies specifying capability scopes, allowed paths, and parameter invariants.',
  },
  {
    step: '3',
    title: 'Run Adversarial CI & Enforce',
    body: 'Execute Mastyf Swarm to probe boundary vulnerabilities, then switch Gateway to Block Mode. Every unauthorized or unconfirmed action is halted with 0 backend bytes sent.',
  },
] as const;

/** Formal Guarantees vs. Explicit Limitations */
export const GUARANTEES_AND_LIMITATIONS = {
  guarantees: [
    'Under complete mediation axioms (A1–A6), no tool call outside authorized capability scopes can be dispatched to backend infrastructure.',
    'Any blocked or uncertain tool invocation produces strictly zero bytes transmitted across the tool transport wire.',
    'Learned semantic models (Mastyf Guard) can revoke or escalate authority, but can never synthesize or grant permission (Afinal ⊆ Astruct).',
    'Unconfirmed tool execution (ExecutionCertainty = UNKNOWN) cannot silently advance dependent workflow state (Theorem 3).',
  ],
  limitations: [
    'Mastyf does not make an autoregressive Transformer intrinsically safe; it prevents compromised model outputs from executing privileged actions.',
    'Semantic neural auditing is distribution-bounded (empirical FNR of 21.5% on in-scope manipulations prior to boundary sharpening) and subject to adversarial evasion without deterministic invariants.',
    'Decentralized Information Flow Control (DIFC) tracks explicit data flow channels; it does not eliminate covert timing or semantic side-channels.',
    'Protection guarantees apply exclusively to tool execution paths routed through the Mastyf reference monitor.',
  ],
} as const;

const SHIELD_PLATFORM_NAMES = SHIELD_PLATFORM_ORDER.filter(shieldPlatformAvailable)
  .map((id) => SHIELD_PLATFORMS[id].name)
  .join(', ');

const PROTOCOL_X_CHECKS = 'Protocol X model checks on tool calls the rules allow';

/** The plans on the pricing page, docs and dashboard. Checkout prices live in lib/billing/plans.ts. */
export const PRICING_TIERS = [
  {
    id: 'community',
    audience: 'Individuals and researchers',
    highlights: ['Self-hosted Gateway', 'YAML policy engine', 'Public MCP trust scores'],
    shortCta: 'Get it on GitHub',
    name: 'Community',
    price: '₹0',
    billing: 'Free forever · AGPL-3.0',
    description: 'For individual developers, hobbyists, and researchers securing local agents.',
    bullets: [
      'Self-hosted Mastyf Gateway runtime',
      'Local YAML Policy-as-Code engine',
      'Public MCP Trust score directory',
      'Security Swarm community test fixtures',
      'Local audit and decision logging',
      'Community GitHub discussions support',
    ],
    cta: 'Get Started on GitHub',
    href: 'https://github.com/mastyf-ai/mastyf.ai',
    featured: false,
    external: true,
  },
  {
    id: 'developer',
    audience: 'One developer using Claude Desktop, Cursor or Windsurf',
    highlights: ['One person on one device', 'Shield desktop app', 'Protocol X model checks'],
    shortCta: 'Buy',
    name: 'Developer Pro',
    price: formatPlanPrice('developer', 'monthly', true),
    billing: `a month for the first ${DEVELOPER_OFFER_PLACES} customers, then ${formatPlanPrice('developer')}. Or ${formatPlanPrice('developer', 'yearly', true)} a year, then ${formatPlanPrice('developer', 'yearly')}.`,
    description: 'For engineers securing local coding assistants (Claude Desktop, Cursor, Windsurf).',
    bullets: [
      'One person on one device',
      'Commercial development runtime license',
      `Mastyf Shield Desktop for ${SHIELD_PLATFORM_NAMES}`,
      PROTOCOL_X_CHECKS,
      'Automated DIFC taint tracking & wire severance',
      'Continuous streaming MCP CVE threat intelligence',
      'License key the moment your payment clears',
    ],
    cta: 'Buy Developer Pro',
    // Checkout opens from the pricing page and the dashboard (RazorpayCheckoutButton); links land here.
    href: '/dashboard/license',
    featured: true,
    external: false,
  },
  {
    id: 'team',
    audience: 'Teams shipping agents to customers',
    highlights: ['Up to 10 people in one workspace', 'Up to 15 agent environments', 'Attack tests in CI'],
    shortCta: 'Buy',
    name: 'Team',
    price: formatPlanPrice('team'),
    billing: `a month, or ${formatPlanPrice('team', 'yearly')} a year`,
    description: 'For fast-moving AI engineering teams deploying customer-facing autonomous agents.',
    bullets: [
      'Up to 10 people in one workspace, one device each',
      'Up to 15 protected agent environments',
      PROTOCOL_X_CHECKS,
      'Cloud Control Plane with team RBAC',
      'Mastyf Swarm CI/CD automated regression runner',
      'Threat Lab mutation review queue',
      '90-day cryptographic audit log retention',
      'SIEM webhook and telemetry export',
      'Priority email and Slack support',
    ],
    cta: 'Buy Team',
    href: '/dashboard/license',
    featured: false,
    external: false,
  },
  {
    id: 'custom',
    audience: 'Larger teams and regulated systems',
    highlights: ['More people and environments', 'Private or on-premises deployment', 'Terms agreed with you'],
    shortCta: 'Contact us',
    name: 'Custom',
    price: 'Custom',
    billing: 'Priced for your setup',
    description: 'For organizations that need more than 10 people, a private deployment, or their own terms.',
    bullets: [
      'More than 10 people or 15 agent environments',
      'Private VPC, on-premises or air-gapped deployment',
      'Support and terms agreed with you',
    ],
    cta: 'Contact us',
    href: '/pilot',
    featured: false,
    external: false,
  },
] as const;

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
] as const;

export { SITE_NAME };

