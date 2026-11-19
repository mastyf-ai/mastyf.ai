'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, ArrowUpRight, Download } from 'lucide-react';
import { HF_MODEL_URL } from '@/lib/product-links';
import { Flip } from '@/components/ui/Flip';

const GATES = [
  {
    id: 1,
    name: 'Schema sanity',
    latency: '0.6 µs',
    title: 'Gate 1 (Schema & Parse Clamping):',
    body: 'Validates tool name and argument JSON structures against pre-compiled AST schemas. Drops malformed or oversized payloads in under 1 microsecond.',
  },
  {
    id: 2,
    name: 'CBAC invariants',
    latency: '~1.5 ms',
    title: 'Gate 2 (Deterministic CBAC Invariants):',
    body: 'Evaluates 4 relational argument constraints: destination containment, scope boundedness, privilege monotonicity, and monetary clamping.',
  },
  {
    id: 3,
    name: 'DIFC taint flow',
    latency: 'Realtime',
    title: 'Gate 3 (Dynamic Information Flow Control):',
    body: 'Taints data ingested from third-party documents, emails, or web pages; strictly forbids tainted tokens from flowing into privileged sinks.',
  },
  {
    id: 4,
    name: 'Mastyf Guard',
    latency: '1.5B (CPU)',
    title: 'Gate 4 (Subordinate Learned Authority):',
    body: 'Evaluates Mastyf Guard 1.5B INT4 neural checkpoint. Per Theorem 2, it can revoke or escalate, but can never synthesize or grant permission.',
  },
] as const;

/** Interactive inspector for the four Shield gates. */
export function ShieldGates() {
  const [activeGate, setActiveGate] = useState<number>(1);
  const gate = GATES.find((g) => g.id === activeGate) ?? GATES[0];

  return (
    <div className="gates panel">
      <div className="gates__tabs" role="tablist" aria-label="Shield gates">
        {GATES.map((g) => (
          <button
            key={g.id}
            type="button"
            role="tab"
            id={`gate-tab-${g.id}`}
            aria-selected={activeGate === g.id}
            aria-controls="gate-panel"
            className="gates__tab"
            onClick={() => setActiveGate(g.id)}
          >
            <span className="gates__n">Gate {g.id}</span>
            <span className="gates__name">{g.name}</span>
            <span className="gates__lat">{g.latency}</span>
          </button>
        ))}
      </div>
      <p className="gates__detail" role="tabpanel" id="gate-panel" aria-labelledby={`gate-tab-${gate.id}`}>
        <strong>{gate.title}</strong> {gate.body}
      </p>
    </div>
  );
}

const PILLARS = [
  {
    id: 'gateway',
    name: 'Mastyf Gateway',
    role: 'Runtime reverse proxy',
    body: 'High-throughput fail-closed reverse proxy for MCP JSON-RPC, stdio, and HTTP tool calls. Its rules decide in about 1.5 ms per call.',
    tags: ['MCP stdio & HTTP', 'Relational invariants', '~1.5 ms rule check', 'Audit or enforce mode'],
    link: { href: '/developers', label: 'Explore Gateway docs' },
  },
  {
    id: 'swarm',
    name: 'Mastyf Swarm',
    role: 'Adversarial CI/CD',
    body: 'Automated adversarial runner that stress-tests your agent’s execution boundary before deployment using thousands of multi-turn jailbreak and indirect injection vectors.',
    tags: ['4,216 InjecAgent tests', 'Adaptive white-box red team', 'GitHub Actions CI runner', 'Automated regression gates'],
    link: { href: '/developers', label: 'Run Swarm in CI' },
  },
  {
    id: 'trust',
    name: 'Mastyf Trust',
    role: 'MCP supply chain',
    body: 'Static vulnerability scanner and behavioral registry for Model Context Protocol (MCP) servers. Detects excessive permissions, environment leaks, and known CVEs.',
    tags: ['Static AST analysis', 'Permission fingerprinting', 'Certified MCP badges', 'CVE severity index'],
    link: { href: '/trust', label: 'Look up MCP server trust' },
  },
] as const;

const CONTROL_FACTS = [
  { label: 'Cryptographic audit', value: 'Ed25519 signed receipts', detail: 'rcpt_msh_89f02c91a0...' },
  { label: 'Enterprise telemetry', value: 'Real-time SIEM forwarding', detail: 'Datadog, Splunk, S3' },
  { label: 'Identity and RBAC', value: 'SSO and team workspaces', detail: 'Google and GitHub OAuth' },
] as const;

/** The five platform components, each with an anchor id for deep links. */
export function PlatformComponents() {
  return (
    <ul className="pillars">
      <li className="pillar" id="shield">
        <div className="pillar__head">
          <h3>
            <Flip light="var(--accent)">Mastyf Shield</Flip>
          </h3>
          <span className="pillar__role">Appliance and sidecar</span>
        </div>
        <p>
          A reference monitor that runs as a lightweight sidecar alongside your agent processes. Evaluates every tool
          invocation across 4 deterministic gates, in about 1.5 ms. If any check fails, the
          transport wire is severed before a single byte reaches the backend.
        </p>
        <div className="pillar__actions">
          <Link href="/download" className="btn btn-primary btn-sm">
            <Download size={13} strokeWidth={2} aria-hidden="true" />
            Download Mastyf Shield
          </Link>
          <a href={HF_MODEL_URL} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
            Gated 1.5B weights
            <ArrowUpRight size={13} strokeWidth={1.75} aria-hidden="true" />
          </a>
        </div>
      </li>

      {PILLARS.map((pillar) => (
        <li key={pillar.id} className="pillar" id={pillar.id}>
          <div className="pillar__head">
            <h3>
              <Flip light="var(--accent)">{pillar.name}</Flip>
            </h3>
            <span className="pillar__role">{pillar.role}</span>
          </div>
          <p>{pillar.body}</p>
          <ul className="tags">
            {pillar.tags.map((tag) => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
          <Link href={pillar.link.href} className="link-icon">
            {pillar.link.label}
            <ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </li>
      ))}

      <li className="pillar" id="control-plane">
        <div className="pillar__head">
          <h3>
            <Flip light="var(--accent)">Mastyf Control Plane</Flip>
          </h3>
          <span className="pillar__role">Enterprise fleet governance</span>
        </div>
        <p>
          Centralized dashboard and policy distribution network for enterprise agent deployments. Distribute signed
          YAML policies across thousands of agent runners, verify Ed25519-signed, tamper-evident audit trails, and stream events
          to your SIEM.
        </p>
        <span className="badge">SOC2, ISO 27001 ready</span>
        <dl className="facts">
          {CONTROL_FACTS.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>
                {fact.value}
                <span>{fact.detail}</span>
              </dd>
            </div>
          ))}
        </dl>
        <div className="pillar__actions">
          <Link href="/pricing" className="btn btn-primary btn-sm">
            Deploy Control Plane
          </Link>
          <Link href="/solutions" className="btn btn-secondary btn-sm">
            Enterprise overview
          </Link>
        </div>
      </li>
    </ul>
  );
}
