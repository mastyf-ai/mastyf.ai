import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Benchmarks } from '@/components/docs/Benchmarks';
import { CompareTable } from '@/components/docs/CompareTable';
import { CostCalculator } from '@/components/docs/CostCalculator';
import { DocPage, DocSection } from '@/components/docs/DocPage';

export const metadata: Metadata = {
  title: 'Performance and benchmarks — Mastyf docs',
  description: 'Mastyf latency and cost against cloud LLM guardrails, adversarial benchmark results, and how it compares to other agent security tools.',
};

export default function PerformancePage() {
  return (
    <DocPage slug="performance">
      <DocSection id="cost" title="Performance and cost">
        <p>
          Cloud LLM guardrails add around 850 ms per tool call and bill per check. Mastyf&apos;s rules decide locally in
          about 1.5 ms (Protocol X, when it checks a call, takes about a second) for a flat monthly price. Adjust the
          inputs to compare.
        </p>
        <div className="doc-block">
          <CostCalculator />
        </div>
      </DocSection>

      <DocSection id="benchmarks" title="Benchmarks">
        <p>
          Results on standard adversarial evaluation suites, with the methodology and proofs documented in an
          open-access preprint.
        </p>
        <div className="doc-block">
          <Benchmarks />
        </div>
        <Link href="/research" className="link-icon doc-more">
          Paper, theorems, and limitations
          <ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" />
        </Link>
      </DocSection>

      <DocSection id="compare" title="How Mastyf compares">
        <p>
          Most agent security tools moderate the conversation or audit logs after the fact. Mastyf enforces at the
          execution boundary: it authorizes each tool call against your policy, tracks workflow state, and is tested
          continuously by adversarial runs.
        </p>
        <div className="doc-block">
          <CompareTable />
        </div>
      </DocSection>
    </DocPage>
  );
}
