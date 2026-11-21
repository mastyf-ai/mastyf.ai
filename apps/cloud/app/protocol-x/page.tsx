import { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Ban, Check, Flag, Lock, Server } from 'lucide-react';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { safeAuth } from '@/lib/safe-auth';
import { formatPlanPrice } from '@/lib/billing/plans';
import { BENIGN_CHECK, PX_RESULTS } from '@/app/attack-lab/data';
import { PxArena } from './PxArena';
import { PxCounters } from './PxCounters';
import { PxDisguises } from './PxDisguises';
import { PxGauntlet } from './PxGauntlet';
import './protocol-x.css';
import './protocol-x-more.css';

export const metadata: Metadata = {
  title: 'Protocol X — Mastyf',
  description:
    "Protocol X is Mastyf's own model for AI agent security, included in the paid Mastyf Shield. Throw recorded attacks at it, run the whole suite, and compare model releases.",
};

const pctNumber = (s: string) => Number.parseInt(s, 10) || 0;

export default async function ProtocolXPage() {
  const session = await safeAuth();
  const price = formatPlanPrice('developer', 'monthly', true);

  return (
    <>
      <SiteNav session={!!session} />
      <main className="page-main px-page">
        <header className="px-hero">
          <Link href="/pricing" className="px-paid">
            <Lock size={14} strokeWidth={2} aria-hidden="true" />
            Included in Mastyf Shield · paid
          </Link>
          <h1 className="px-hero__title">Protocol X</h1>
          <p className="px-hero__lead">Throw an attack at it.</p>
        </header>

        <section className="px-arena" aria-label="Try Protocol X on recorded attacks">
          <PxArena />
          <p className="px-arena__note">
            Recorded runs, attacks it never saw. <Link href="/docs/protocol-x#how-measured">How we measured</Link>
          </p>
        </section>

        <section className="px-block" aria-labelledby="px-gauntlet-title">
          <h2 id="px-gauntlet-title" className="px-block__title">
            Now throw everything at once
          </h2>
          <p className="px-block__lead">60 recorded attacks and 15 harmless twins. Same cases, two model releases.</p>
          <PxGauntlet />
        </section>

        <section className="px-block" aria-labelledby="px-disguise-title">
          <h2 id="px-disguise-title" className="px-block__title">
            Disguises it learned to see through
          </h2>
          <p className="px-block__lead">Catch rate on the full red-team suite, October model against November.</p>
          <PxDisguises />
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
              { label: 'harmless calls let through', from: 0, to: BENIGN_CHECK.allowed, tail: `/${BENIGN_CHECK.scored}` },
              { label: 'per decision', from: 1, to: 1, prefix: '~', tail: ' s' },
            ]}
          />
        </section>

        <section className="px-block" aria-labelledby="px-pipe-title">
          <h2 id="px-pipe-title" className="px-block__title">
            Where it sits
          </h2>
          <ol className="px-pipe" aria-label="The path of one tool call">
            <li>
              <b>Your agent</b>
              <span>proposes a call</span>
            </li>
            <li>
              <b>Shield rules</b>
              <span>on your machine · ~1.5 ms</span>
            </li>
            <li className="px-pipe__px">
              <b>Protocol X</b>
              <span>Mastyf servers · ~1 s</span>
            </li>
            <li>
              <b>Your tools</b>
              <span>only if allowed</span>
            </li>
          </ol>
          <div className="px-roles">
            <div>
              <Ban size={24} strokeWidth={1.5} aria-hidden="true" />
              <span>Blocks poisoned tool results</span>
            </div>
            <div>
              <Flag size={24} strokeWidth={1.5} aria-hidden="true" />
              <span>Flags risky calls</span>
            </div>
            <div>
              <Server size={24} strokeWidth={1.5} aria-hidden="true" />
              <span>Text checked, never stored</span>
            </div>
          </div>
        </section>

        <section className="px-block px-tier" aria-labelledby="px-tier-title">
          <div className="px-tier__copy">
            <h2 id="px-tier-title" className="px-block__title">
              Protocol X is part of Mastyf Shield
            </h2>
            <p className="px-block__lead">It is not in the free tier. The free engine uses fixed rules on your own servers.</p>
            <div className="px-tier__cta">
              <Link href="/pricing" className="btn btn-primary btn-lg">
                Get Shield from {price}/month
              </Link>
              <Link href="/docs/protocol-x" className="btn btn-lg">
                How it works
                <ArrowRight size={15} strokeWidth={1.75} aria-hidden="true" />
              </Link>
            </div>
            <p className="px-tier__fine">Launch offer price. See all plans on the pricing page.</p>
          </div>
          <div className="px-tier__cols">
            <div className="px-tier__col">
              <h3>Free</h3>
              <ul>
                <li>Fixed policy rules</li>
                <li>On your own servers</li>
              </ul>
            </div>
            <div className="px-tier__col px-tier__col--paid">
              <h3>Shield</h3>
              <ul>
                {['Protocol X model checks', 'DIFC taint tracking', 'Argument-intent auditor', 'Causal gate', 'Signed receipt per block', 'Your dashboard'].map((f) => (
                  <li key={f}>
                    <Check size={14} strokeWidth={2} aria-hidden="true" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <div className="px-cta">
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
