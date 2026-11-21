import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { LegacyDocsRedirect } from '@/components/docs/LegacyDocsRedirect';
import { DOC_TOPICS, docHref } from '@/components/docs/topics';

export const metadata: Metadata = {
  title: 'Docs — Mastyf',
  description:
    'Mastyf documentation: getting started, connecting your agent, how enforcement works, the Shield app, performance, guarantees and research, plans, and help.',
};

export default function DocsIndexPage() {
  return (
    <main id="main" className="docs__main">
      <LegacyDocsRedirect />
      <header className="docs__intro">
        <h1>Documentation</h1>
        <p>How Mastyf enforces policy on agent tool calls, how to connect your agent, and how to run it.</p>
      </header>

      <ul className="doc-topics">
        {DOC_TOPICS.map((topic) => (
          <li key={topic.slug}>
            <Link href={docHref(topic.slug)} className="doc-topic">
              <span className="doc-topic__title">
                {topic.title}
                <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span className="doc-topic__summary">{topic.summary}</span>
              {topic.sections.length > 1 ? (
                <span className="doc-topic__sections">{topic.sections.map((s) => s.label).join(' · ')}</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
