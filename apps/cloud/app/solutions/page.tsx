import { Metadata } from 'next';
import Link from 'next/link';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { DynamicBackground } from '@/components/landing/DynamicBackground';
import { safeAuth } from '@/lib/safe-auth';
import '../landing.css';

export const metadata: Metadata = {
  title: 'Solutions — Mastyf AI Agent Security Platform',
  description:
    'Security solutions for Model Context Protocol (MCP), autonomous coding agents (Claude Code, Cursor), enterprise database connections, and regulated AI workflows.',
};

export default async function SolutionsPage() {
  const session = await safeAuth();

  const solutions = [
    {
      id: 'mcp-security',
      title: 'Model Context Protocol (MCP) Security',
      tagline: 'Secure every MCP connection before execution',
      description:
        'Anthropic&rsquo;s Model Context Protocol gives agents ambient access to servers and tools. Mastyf Gateway intercepts JSON-RPC dispatch, verifies cryptographic HMAC tokens, and enforces destination containment so malicious prompts cannot invoke unauthorized tools.',
      benefits: ['Zero-byte wire isolation on block', 'Live MCP package trust scanning', 'Dynamic HMAC token verification'],
    },
    {
      id: 'coding-agents',
      title: 'Autonomous Coding Agents',
      tagline: 'Control what Claude Code, Cursor, and IDE agents can execute',
      description:
        'Developer agents execute terminal commands, edit repositories, and pull dependencies. Mastyf establishes strict path containment and shell command filtering, preventing prompt injection in dependencies from compromising developer machines.',
      benefits: ['Directory sandbox containment', 'Shell pipeline injection blocking', 'Secret & API key egress prevention'],
    },
    {
      id: 'enterprise-agents',
      title: 'Enterprise ERP & Database Agents',
      tagline: 'Connect agents to sensitive data stores without granting ungranted authority',
      description:
        'When agents query SQL databases or CRM platforms, untrusted inputs can trigger bulk exfiltration. Mastyf enforces Decentralized Information Flow Control (DIFC) to prevent tainted database outputs from routing to external webhooks.',
      benefits: ['Decentralized taint tracking', 'Aggregate financial & volume clamping', 'Multi-tenant isolation'],
    },
    {
      id: 'regulated-industries',
      title: 'Regulated & High-Consequence Workflows',
      tagline: 'Cryptographic evidence, non-repudiation, and audit certainty',
      description:
        'Financial services, healthcare, and government systems require verifiable assurance. Mastyf enforces Theorem 3 (Execution-Certainty Non-Advancement) and generates Ed25519-signed execution receipts for every tool call.',
      benefits: ['Tamper-evident audit receipts', 'OWASP Agentic Top 10 alignment', 'Stateful workflow synchronization'],
    },
  ];

  return (
    <div className="landing">
      <DynamicBackground />
      <SiteNav session={!!session} />
      <main className="pt-24 pb-16">
        <div className="lp-section">
          <div className="lp-section-header">
            <span className="lp-pill lp-pill-gold">Enterprise Use Cases</span>
            <h1>Targeted Solutions for Modern AI Agents</h1>
            <p>
              Whether you are securing developer IDE agents, customer-facing chatbots, or internal database orchestrators, Mastyf provides drop-in execution perimeters.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 my-10">
            {solutions.map((s) => (
              <div key={s.id} className="card p-8">
                <span className="lp-pill text-xs mb-3 inline-block">{s.title}</span>
                <h3 className="text-xl font-bold text-white mb-2">{s.tagline}</h3>
                <p className="text-xs text-slate-300 mb-6 leading-relaxed">{s.description}</p>
                <ul className="flex flex-col gap-2 mb-6">
                  {s.benefits.map((b) => (
                    <li key={b} className="text-xs text-slate-400 flex items-center gap-2">
                      <span className="text-amber-400 font-bold">✓</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/pilot" className="btn btn-secondary btn-sm btn-pill">
                  Start Solution Pilot →
                </Link>
              </div>
            ))}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
