import type { Metadata } from 'next';
import Link from 'next/link';
import { DocPage, DocSection } from '@/components/docs/DocPage';
import { Guarantees } from '@/components/docs/Guarantees';
import { IncidentFeed } from '@/components/docs/IncidentFeed';
import { AcademicPaperHero } from '@/components/landing/AcademicPaperHero';

export const metadata: Metadata = {
  title: 'Guarantees and research — Mastyf docs',
  description: 'What the Mastyf architecture guarantees, its documented limits, the paper and proofs, and a live feed of agent security incidents.',
};

export default function SecurityModelPage() {
  return (
    <DocPage slug="security-model">
      <DocSection id="guarantees" title="Guarantees and limits">
        <p>What the architecture guarantees, and the limits documented in the published research, side by side.</p>
        <div className="doc-block">
          <Guarantees />
        </div>
      </DocSection>

      <DocSection id="paper" title="Paper and proofs">
        <p>
          The abstract, the invariants and theorems with their proofs, the six-regime results, and a BibTeX entry. To
          read the paper itself, open the <Link href="/research">research page</Link>.
        </p>
        <div className="doc-block">
          <AcademicPaperHero />
        </div>
      </DocSection>

      <DocSection id="threats" title="Threat landscape">
        <p>
          A live, uncurated feed of public reporting on prompt injection, tool poisoning, and agent breaches. Each of
          these happened because an agent executed a tool call nobody checked.
        </p>
        <div className="doc-block">
          <IncidentFeed />
        </div>
      </DocSection>
    </DocPage>
  );
}
