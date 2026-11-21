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
          Mastyf&rsquo;s rules decide on your own machine in about 1.5 ms per call. Protocol X, when it checks, takes
          about a second. Cloud guardrails that send every call to a model add around 850 ms and bill per check. Change
          the numbers to compare.
        </p>
        <div className="doc-block">
          <CostCalculator />
        </div>
      </DocSection>

      <DocSection id="benchmarks" title="Benchmarks">
        <p>Results on public attack benchmarks. How each was measured is in the open-access paper.</p>
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
          Most agent security tools watch the conversation, or read the logs after the fact. Mastyf checks each action
          before it runs.
        </p>
        <div className="doc-block">
          <CompareTable />
        </div>
      </DocSection>
    </DocPage>
  );
}
