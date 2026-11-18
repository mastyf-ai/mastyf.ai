import { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { safeAuth } from '@/lib/safe-auth';
import { BENIGN_CHECK, PX_RESULTS } from '@/app/attack-lab/data';
import { Playground } from '@/app/attack-lab/Playground';
import '@/app/attack-lab/attack-lab.css';
import './protocol-x.css';

export const metadata: Metadata = {
  title: 'Protocol X — Mastyf',
  description:
    "Protocol X is Mastyf's own model for AI agent security, included in Mastyf Shield. Try it on recorded attacks it has never seen.",
};

export default async function ProtocolXPage() {
  const session = await safeAuth();

  return (
    <>
      <SiteNav session={!!session} />
      <main className="page-main">
        <header className="page-head">
          <p className="eyebrow">Included in Mastyf Shield</p>
          <h1 className="page-head__title">Protocol X</h1>
          <p className="page-head__lead">
            Mastyf&apos;s own model for AI agent security. It reads what tools send back to your agent, and the calls your
            agent makes, and decides before anything reaches the agent or your systems.
          </p>

          <dl className="facts px-facts">
            <div>
              <dt>Attacker success</dt>
              <dd>
                {PX_RESULTS.agentdojo.before} → {PX_RESULTS.agentdojo.after}
              </dd>
              <span className="px-facts__note">
                No defense vs Protocol X, AgentDojo, {PX_RESULTS.agentdojo.cases} attacked cases
              </span>
            </div>
            <div>
              <dt>New attacks tested</dt>
              <dd>{PX_RESULTS.novelAttacks}</dd>
              <span className="px-facts__note">From our red team, none in the model&apos;s training data</span>
            </div>
            <div>
              <dt>Ordinary calls allowed</dt>
              <dd>
                {BENIGN_CHECK.allowed} / {BENIGN_CHECK.scored}
              </dd>
              <span className="px-facts__note">Harmless calls scored in the same check</span>
            </div>
            <div>
              <dt>Decision time</dt>
              <dd>{PX_RESULTS.decisionTime}</dd>
              <span className="px-facts__note">Median, on a laptop CPU</span>
            </div>
          </dl>

          <div className="page-head__actions">
            <Link href="/pricing" className="btn btn-primary">
              Get Mastyf Shield
            </Link>
            <Link href="/attack-lab" className="btn">
              Every attack in the Attack Lab
              <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
            </Link>
          </div>
        </header>

        <section className="section section--flush-top px-try" aria-labelledby="px-try-title">
          <h2 id="px-try-title">Try an attack</h2>
          <p className="px-try__lead">
            Pick what an attacker wants and how they disguise it, then send it through Protocol X. Every verdict, score and
            time here is a recorded run of Protocol X on our red-team suite, attacks it never saw in training. Nothing on
            this page calls the model.
          </p>
          <Playground />
        </section>

        <section className="section px-does" aria-labelledby="px-does-title">
          <h2 id="px-does-title">What it does in Shield</h2>
          <ul className="px-does__list">
            <li>
              <h3>Tool results: blocks</h3>
              <p>
                A web page, file or message that carries hidden instructions is stopped before your agent reads it, and the
                agent is never shown the words that were caught.
              </p>
            </li>
            <li>
              <h3>Tool calls: flags</h3>
              <p>
                Calls it judges risky are recorded for review, while Mastyf&apos;s fixed rules block the clearly dangerous ones:
                reading secret files, sending credentials out, downloading and running code.
              </p>
            </li>
            <li>
              <h3>Where it runs</h3>
              <p>On Mastyf&apos;s servers. Shield sends each check to Protocol X using your Shield licence.</p>
            </li>
          </ul>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
