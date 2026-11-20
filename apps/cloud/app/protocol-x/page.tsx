import { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Ban, Flag, Server } from 'lucide-react';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { safeAuth } from '@/lib/safe-auth';
import { BENIGN_CHECK, PX_RESULTS } from '@/app/attack-lab/data';
import { PxArena } from './PxArena';
import { PxCounters } from './PxCounters';
import './protocol-x.css';

export const metadata: Metadata = {
  title: 'Protocol X — Mastyf',
  description:
    "Protocol X is Mastyf's own model for AI agent security, included in Mastyf Shield. Throw a recorded attack at it and watch it decide.",
};

const pctNumber = (s: string) => Number.parseInt(s, 10) || 0;

export default async function ProtocolXPage() {
  const session = await safeAuth();

  return (
    <>
      <SiteNav session={!!session} />
      <main className="page-main px-page">
        <header className="px-hero">
          <h1 className="px-hero__title">Protocol X</h1>
          <p className="px-hero__lead">Throw an attack at it.</p>
        </header>

        <section className="px-arena" aria-label="Try Protocol X on recorded attacks">
          <PxArena />
          <p className="px-arena__note">
            Recorded runs, attacks it never saw.{' '}
            <Link href="/docs/protocol-x#how-measured">How we measured</Link>
          </p>
        </section>

        <section className="px-numbers" aria-label="Results">
          <PxCounters
            items={[
              {
                label: `attacker success, down from ${PX_RESULTS.agentdojo.before}`,
                from: pctNumber(PX_RESULTS.agentdojo.before),
                to: pctNumber(PX_RESULTS.agentdojo.after),
                suffix: '%',
              },
              { label: 'new attacks tested', from: 0, to: PX_RESULTS.novelAttacks },
              {
                label: 'harmless calls let through',
                from: 0,
                to: BENIGN_CHECK.allowed,
                tail: `/${BENIGN_CHECK.scored}`,
              },
              { label: 'per decision', from: 1, to: 1, prefix: '~', tail: ' s' },
            ]}
          />
        </section>

        <section className="px-roles" aria-label="What it does in Shield">
          <div>
            <Ban size={26} strokeWidth={1.5} aria-hidden="true" />
            <span>Blocks poisoned tool results</span>
          </div>
          <div>
            <Flag size={26} strokeWidth={1.5} aria-hidden="true" />
            <span>Flags risky calls</span>
          </div>
          <div>
            <Server size={26} strokeWidth={1.5} aria-hidden="true" />
            <span>Runs on Mastyf&rsquo;s servers</span>
          </div>
        </section>

        <div className="px-cta">
          <Link href="/pricing" className="btn btn-primary btn-lg">
            Get Mastyf Shield
          </Link>
          <Link href="/docs/protocol-x" className="btn btn-lg">
            How it works
            <ArrowRight size={15} strokeWidth={1.75} aria-hidden="true" />
          </Link>
          <Link href="/attack-lab" className="link-icon">
            Every attack in the Attack Lab
            <ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
