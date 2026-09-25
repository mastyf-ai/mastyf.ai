import { Metadata } from 'next';
import Link from 'next/link';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { DynamicBackground } from '@/components/landing/DynamicBackground';
import { GuaranteesLimitationsSection } from '@/components/landing/GuaranteesLimitationsSection';
import { safeAuth } from '@/lib/safe-auth';
import '../landing.css';

export const metadata: Metadata = {
  title: 'Trust Center & Security Architecture — Mastyf',
  description:
    'Security architecture, privacy controls, compliance mappings, and threat modeling for the Mastyf AI Agent Security Platform.',
};

export default async function TrustPage() {
  const session = await safeAuth();

  const complianceStandards = [
    {
      framework: 'OWASP Top 10 for Agentic Applications (2026)',
      coverage: 'Complete',
      description:
        'Directly maps to and neutralizes Goal Hijacking (ASI01), Tool Misuse (ASI02), Identity Abuse (ASI03), and Cascading Failures (ASI05) through execution-boundary reference monitors.',
    },
    {
      framework: 'NIST Software Agent Security (2026)',
      coverage: 'Aligned',
      description:
        'Addresses non-repudiation, granular delegation, and cryptographic auditability for autonomous software agents accessing tools and data stores.',
    },
    {
      framework: 'SOC 2 & ISO 27001 Control Mapping',
      coverage: 'Audit Ready',
      description:
        'Cryptographic Ed25519 execution receipts provide tamper-evident proof of authorization and execution certainty for third-party compliance auditors.',
    },
  ];

  return (
    <div className="landing">
      <DynamicBackground />
      <SiteNav session={!!session} />
      <main className="pt-24 pb-16">
        <div className="lp-section">
          <div className="lp-section-header">
            <span className="lp-pill lp-pill-gold">Trust &amp; Compliance</span>
            <h1>Mastyf Trust Center</h1>
            <p>
              How Mastyf protects your data, isolates execution environments, and satisfies enterprise compliance standards.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 my-10">
            <div className="card p-6">
              <span className="lp-pill text-xs mb-3 inline-block">Architecture</span>
              <h3 className="text-lg font-bold text-white mb-2">Zero-Trust Reference Monitor</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                The reference monitor operates as an independent out-of-band proxy. Compromise of the LLM or agent memory bus cannot bypass transport-level complete mediation.
              </p>
            </div>

            <div className="card p-6">
              <span className="lp-pill text-xs mb-3 inline-block">Privacy</span>
              <h3 className="text-lg font-bold text-white mb-2">Zero Payload Retention</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Mastyf Gateway evaluates payloads ephemerally in memory. Prompt text and tool arguments are never stored or transmitted to external servers without explicit policy configuration.
              </p>
            </div>

            <div className="card p-6">
              <span className="lp-pill text-xs mb-3 inline-block">Cryptography</span>
              <h3 className="text-lg font-bold text-white mb-2">Ed25519 Execution Receipts</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Every authorization decision generates a signed, non-repudiable cryptographic receipt, ensuring that all agent actions can be independently audited.
              </p>
            </div>
          </div>

          <div className="my-10">
            <h3 className="text-xl font-bold text-white mb-4">Compliance Framework Alignment</h3>
            <div className="flex flex-col gap-4">
              {complianceStandards.map((st) => (
                <div key={st.framework} className="card p-6">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="text-white font-bold text-base m-0">{st.framework}</h4>
                    <span className="lp-pill lp-pill-gold text-xs">{st.coverage}</span>
                  </div>
                  <p className="text-xs text-slate-300 m-0 leading-relaxed">{st.description}</p>
                </div>
              ))}
            </div>
          </div>

          <GuaranteesLimitationsSection />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
