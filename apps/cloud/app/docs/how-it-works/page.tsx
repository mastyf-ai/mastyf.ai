import type { Metadata } from 'next';
import Link from 'next/link';
import { DocPage, DocSection } from '@/components/docs/DocPage';
import { DocFlow, DocTable } from '@/components/docs/DocVisuals';
import { RecordedVerdicts } from '@/components/docs/RecordedVerdicts';

export const metadata: Metadata = {
  title: 'How enforcement works — Mastyf docs',
  description:
    'The checks every tool call and tool result passes, in order, with recorded verdicts from the free engine, what Shield adds, and what happens when no check can be made.',
};

export default function HowItWorksPage() {
  return (
    <DocPage slug="how-it-works">
      <DocSection id="calls" title="A tool call">
        <DocFlow
          label="The checks on a tool call, in order"
          steps={[
            { label: 'Tool list', sub: 'unchanged since first seen?', tone: 'check' },
            { label: 'Built-in guards', sub: 'paths, SQL, URLs, injection', tone: 'check' },
            { label: 'Your rules', sub: 'patterns, denied tools, limits', tone: 'check' },
            { label: 'The tool runs', tone: 'ok' },
          ]}
        />
        <p>
          The first check that fails stops the call, and the tool never runs. Anything that passes every check goes
          through unchanged.
        </p>
      </DocSection>

      <DocSection id="results" title="A tool result">
        <DocFlow
          label="The checks on a tool result"
          steps={[
            { label: 'The tool answers' },
            { label: 'Hidden instructions?', sub: 'then blocked', tone: 'stop' },
            { label: 'Secrets?', sub: 'then replaced', tone: 'check' },
            { label: 'The model reads it', tone: 'ok' },
          ]}
        />
        <p>
          A result is written by whoever controls the tool: a web page, an email, a file in someone else&rsquo;s
          repository. So a blocked result never names the words that were caught, and the model is told only which check
          stopped it.
        </p>
      </DocSection>

      <DocSection id="recorded" title="Recorded verdicts">
        <RecordedVerdicts />
      </DocSection>

      <DocSection id="shield-adds" title="What Shield adds">
        <p>
          The <Link href="/docs/shield">Shield app</Link> runs every free check above, then these paid layers:
        </p>
        <DocTable
          head={['Layer', 'What it does']}
          rows={[
            [<Link key="px" href="/docs/protocol-x">Protocol X</Link>, 'Mastyf’s model reads each result in context and blocks attacks fixed rules miss. On tool calls it records what it finds for you to review.'],
            ['DIFC taint tracking', 'Marks data that came from untrusted places (web pages, emails, files) and stops it flowing out.'],
            ['Argument-intent auditor', 'Checks that a call’s arguments match what you actually asked the agent to do.'],
            ['Causal gate', 'Stops tool calls that were set off by untrusted content instead of by you.'],
            ['Signed receipts', 'Every block gets a signed, chained receipt you can export.'],
          ]}
        />
      </DocSection>

      <DocSection id="fail-closed" title="When no check can be made">
        <p>Mastyf is a security control, so when it can&rsquo;t decide, the default is to block.</p>
        <DocTable
          head={['Where', 'If the check can’t run']}
          rows={[
            [<Link key="py" href="/docs/python#unavailable">Python library</Link>, <>The call raises <code>MastyfUnavailable</code>. You can choose to allow instead.</>],
            [<Link key="api" href="/docs/check#verdict">Check API</Link>, 'A 500 means not checked; treat it as a block.'],
            [<Link key="cp" href="/docs/copilot#what-happens">Copilot hooks</Link>, 'The call is denied and the result withheld.'],
            ['Any client', 'An input too large to check is always blocked.'],
          ]}
        />
      </DocSection>
    </DocPage>
  );
}
