import { Metadata } from 'next';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { DynamicBackground } from '@/components/landing/DynamicBackground';
import { AcademicPaperHero } from '@/components/landing/AcademicPaperHero';
import { GuaranteesLimitationsSection } from '@/components/landing/GuaranteesLimitationsSection';
import { safeAuth } from '@/lib/safe-auth';
import '../landing.css';

export const metadata: Metadata = {
  title: 'Research Portal & Academic Paper — Mastyf AI Agent Security',
  description:
    'Capability-Mediated Perimeters for Secure AI Agent Tool Execution. Peer-reviewed treatise, formal invariants, theorems, and 6-regime empirical benchmarks by Rudraneel Das.',
};

export default async function ResearchPage() {
  const session = await safeAuth();

  return (
    <div className="landing">
      <DynamicBackground />
      <SiteNav session={!!session} />
      <main className="pt-24 pb-16">
        <div className="lp-section">
          <div className="lp-section-header">
            <span className="lp-pill lp-pill-gold">Reproducible Science &amp; Formal Foundations</span>
            <h1>Academic Research Portal</h1>
            <p>
              Security infrastructure must be founded on verifiable proofs and rigorous empirical evaluation, not marketing claims.
            </p>
          </div>

          <AcademicPaperHero standalone={true} />

          <div className="my-16">
            <div className="lp-section-header" style={{ textAlign: 'left', margin: '0 0 1.5rem' }}>
              <span className="lp-pill text-xs">Mathematical Specification</span>
              <h3 className="text-2xl font-bold text-white mt-1">Core Execution-Certainty Semantics</h3>
              <p className="text-slate-400 text-sm">
                How Mastyf formalizes tool execution states to prevent desynchronization attacks in autonomous agent workflows.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="card p-6 bg-black/40 border border-white/5">
                <span className="font-mono text-xs text-rose-400 font-bold block mb-1">State 1: NOT_SENT</span>
                <h4 className="text-sm font-bold text-white mb-2">Wire Isolation Invariant</h4>
                <p className="text-xs text-slate-300 font-mono leading-relaxed">
                  ExecutionBytes(a) = 0. Tool call was rejected by CBAC, DIFC, or Guard auditor before any transport socket or pipe write occurred.
                </p>
              </div>

              <div className="card p-6 bg-black/40 border border-white/5">
                <span className="font-mono text-xs text-amber-400 font-bold block mb-1">State 2: SENT_CHILD_NO_RESPONSE</span>
                <h4 className="text-sm font-bold text-white mb-2">Transient Dispatch State</h4>
                <p className="text-xs text-slate-300 font-mono leading-relaxed">
                  ExecutionBytes(a) &gt; 0, but verified return confirmation has not arrived. ExecutionCertainty(a) = UNKNOWN. Downstream steps locked.
                </p>
              </div>

              <div className="card p-6 bg-black/40 border border-white/5">
                <span className="font-mono text-xs text-emerald-400 font-bold block mb-1">State 3: RESPONSE_RECEIVED</span>
                <h4 className="text-sm font-bold text-white mb-2">Verified State Transition</h4>
                <p className="text-xs text-slate-300 font-mono leading-relaxed">
                  Response verified and cryptographic execution receipt generated. Only now can dependent downstream DAG tasks receive authorization.
                </p>
              </div>
            </div>
          </div>

          <GuaranteesLimitationsSection />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
