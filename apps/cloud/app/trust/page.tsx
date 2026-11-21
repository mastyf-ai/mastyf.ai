import { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { DocFlow, DocTable } from '@/components/docs/DocVisuals';
import { Guarantees } from '@/components/docs/Guarantees';
import { GITHUB_REPO_URL } from '@/lib/github-links';
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/support';
import { safeAuth } from '@/lib/safe-auth';
import './trust.css';

export const metadata: Metadata = {
  title: 'Trust center — Mastyf',
  description:
    'Where your data goes when you use Mastyf, how its checks are built, signed receipts for every block, what it guarantees and its limits, and how to report a security issue.',
};

const BUILT = [
  {
    title: 'Outside the model',
    body: 'The checks run outside the AI model. A model that has been misled can’t switch them off or talk its way past them.',
  },
  {
    title: 'Blocks when unsure',
    body: 'If a check can’t run, the call is blocked by default. Nothing runs unchecked unless you choose that.',
  },
  {
    title: 'Code you can read',
    body: 'The free check engine is open source under AGPL-3.0, so anyone can read the code that decides.',
  },
] as const;

export default async function TrustPage() {
  const session = await safeAuth();

  return (
    <>
      <SiteNav session={!!session} />
      <main className="page-main">
        <header className="page-head">
          <h1 className="page-head__title">Trust center</h1>
          <p className="page-head__lead">Where your data goes, how the checks are built, and what we promise.</p>
        </header>

        <section className="section section--flush-top" aria-labelledby="data-title">
          <h2 id="data-title">Your data</h2>
          <DocTable
            head={['', 'Free checks', 'Shield app']}
            rows={[
              ['Your tool calls and results', 'Checked on your machine; never sent to Mastyf', 'Kept on your PC'],
              ['Your workspace on mastyf.ai', 'Not used', 'One redacted record per call; full arguments never leave your PC'],
              ['Protocol X checks', 'Not used', 'Sent to Mastyf’s servers with your licence, checked, not stored'],
              ['Your conversations with the model', 'Never read', 'Never read'],
            ]}
          />
        </section>

        <section className="section" aria-labelledby="built-title">
          <h2 id="built-title">How it’s built</h2>
          <ul className="trust-built">
            {BUILT.map((b) => (
              <li key={b.title}>
                <h3>{b.title}</h3>
                <p>{b.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="section" aria-labelledby="receipts-title">
          <h2 id="receipts-title">A signed receipt for every block</h2>
          <DocFlow
            label="From a block to an audit"
            steps={[
              { label: 'A call is blocked' },
              { label: 'Receipt signed', sub: 'with a key made on your PC', tone: 'check' },
              { label: 'Chained', sub: 'to the receipt before it', tone: 'check' },
              { label: 'Exported', sub: 'JSON or PDF', tone: 'ok' },
            ]}
          />
          <p className="trust-note">
            Changing or removing a receipt breaks its signature or the chain. You can use receipts as evidence in your
            own SOC 2 or ISO 27001 audit.{' '}
            <Link href="/docs/shield#receipts" className="link-icon">
              How receipts work
              <ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" />
            </Link>
          </p>
        </section>

        <section className="section" aria-labelledby="guarantees-title">
          <h2 id="guarantees-title">What we promise, and where it stops</h2>
          <Guarantees />
        </section>

        <section className="section" aria-labelledby="report-title">
          <h2 id="report-title">Report a security issue</h2>
          <p className="trust-note">
            Email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> instead of opening a public issue. The process is in our{' '}
            <a href={`${GITHUB_REPO_URL}/blob/main/SECURITY.md`} target="_blank" rel="noopener noreferrer">
              security policy
            </a>
            .
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
