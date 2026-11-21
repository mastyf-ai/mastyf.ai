import { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { AttackSimulator } from '@/components/authority/AttackSimulator';
import { AuthorityFlow } from '@/components/authority/AuthorityFlow';
import { RiskModelDemo } from '@/components/authority/RiskModelDemo';
import { ThinkingFilm } from '@/components/authority/ThinkingFilm';
import { CeilingAudit, OpenSourceCard, PilotResults } from '@/components/authority/CeilingAudit';
import { AuthorityPricing } from '@/components/authority/AuthorityPricing';
import '@/app/attack-lab/attack-lab.css';
import { LayerExplorer } from '@/components/authority/LayerExplorer';
import { CeilingCalculator } from '@/components/authority/CeilingCalculator';
import { AgentBench, AttackMatrix, DetectionChart } from '@/components/authority/Benchmarks';
import { safeAuth } from '@/lib/safe-auth';
import './authority.css';

export const metadata: Metadata = {
  title: 'Mastyf Authority — research preview',
  description:
    'A break-in with a ceiling: data keys, irreversible actions and AI agents governed so the worst case of any compromise is a known, tested number.',
};

const STATS = [
  { n: '0', l: 'records for a stolen password or session' },
  { n: '5,000', l: 'records a day at most, even with malware on the laptop' },
  { n: '0 of 12', l: 'mass deletions executed in a ransomware run' },
  { n: '1.6%', l: 'of worst-case AI agent hijacks succeed' },
  { n: '179 / 187', l: 'real insiders flagged, no attack examples used' },
  { n: '0', l: 'known vulnerabilities in dependencies' },
];

const NOT_COVERED = [
  ['Bugs in your own apps, browsers or operating systems', 'We limit what an exploited account can then take; we do not stop the first exploit.'],
  ['Inbound phishing delivery', 'Mail security. A phished login without the person’s device gets nothing.'],
  ['Network floods (DDoS)', 'A DDoS provider. Our front door caps connections and rates.'],
  ['Copying to USB on the laptop', 'Endpoint DLP. The vault caps what reached the laptop; marks trace leaks.'],
  ['People misusing what they may legitimately see', 'Need-to-know and budgets narrow it; marks identify who leaked it.'],
];

export default async function AuthorityPage() {
  const session = await safeAuth();
  return (
    <>
      <SiteNav session={!!session} />
      <main className="page-main auth-page">
        <header className="page-head auth-hero">
          <p className="eyebrow eyebrow--dot">Research preview · Open source · Mastyf Authority</p>
          <h1 className="page-head__title">Every break‑in gets a ceiling.</h1>
          <p className="page-head__lead">
            Most security tries to spot attackers. Authority assumes some will get in, and makes the worst they can do a
            small, known number: computed in advance, enforced where the data and the irreversible actions live, and
            tested by attacking it.
          </p>
          <div className="page-head__actions">
            <a href="#report" className="btn btn-primary">Get your free ceiling report<ArrowRight size={14} strokeWidth={2} aria-hidden="true" /></a>
            <a href="#pricing" className="btn">Pricing</a>
            <a href="#flow" className="btn">See it work</a>
            <a href="https://github.com/mastyf-ai/mastyf-authority" className="btn" target="_blank" rel="noopener noreferrer">Read the code on GitHub</a>
            <a href="#benchmarks" className="btn">See the benchmarks</a>
            <Link href="/pilot" className="link-icon">Join the pilot<ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" /></Link>
          </div>
          <ul className="auth-stats">
            {STATS.map((s) => (
              <li key={s.l}><strong>{s.n}</strong><span>{s.l}</span></li>
            ))}
          </ul>
        </header>

        <section id="report" className="section auth-section">
          <div className="auth-section__head">
            <p className="eyebrow">For security teams · free for our first 10 companies</p>
            <h2 className="auth-h2">Find out the most a stolen login can take from your company</h2>
            <p className="auth-lead">
              Your board, your auditors and your insurer all ask the same question: if one account is stolen, how bad
              can it get? Send us 30 days of read-only logs and get the answer, per account, in 48 hours, with the
              limits that would cap it.
            </p>
          </div>
          <CeilingAudit />
        </section>

        <section id="pilots" className="section auth-section">
          <div className="auth-section__head">
            <p className="eyebrow">Pilot results · shadow mode, default policy</p>
            <h2 className="auth-h2">What it did on real logs</h2>
            <p className="auth-lead">
              Shadow mode scores what Authority would have done and blocks nothing. Three runs so far, with the
              numbers that matter: how often a real person would have been interrupted, and what it caught.
            </p>
          </div>
          <PilotResults />
        </section>

        <section id="film" className="section auth-section">
          <div className="auth-section__head">
            <p className="eyebrow">Watch · 4 min</p>
            <h2 className="auth-h2">Last week&apos;s breaches, rewound</h2>
            <p className="auth-lead">
              A short film: the real attacks from one week in the news, how each one happened, and how a damage ceiling
              would have capped it. Includes the three that were bugs we would not have stopped.
            </p>
          </div>
          <figure className="auth-film">
            <video
              className="auth-film__video"
              controls
              playsInline
              preload="metadata"
              poster="/media/authority-launch-poster.jpg"
            >
              <source src="/media/authority-launch.mp4" type="video/mp4" />
              Your browser does not support the video tag.
            </video>
          </figure>
        </section>

        <section id="flow" className="section auth-section">
          <header className="sec-head sec-head--split">
            <div>
              <p className="eyebrow">How it works · simulated from measured runs</p>
              <h2 className="auth-h2">Your apps ask. Authority decides how much.</h2>
            </div>
            <a href="#try" className="link-icon sec-head__link">Pick your own attacker<ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" /></a>
          </header>
          <AuthorityFlow />
        </section>

        <section id="behaviour" className="section auth-section">
          <div className="auth-section__head">
            <p className="eyebrow">Behavioural risk model · interactive</p>
            <h2 className="auth-h2">It learns what normal looks like for each person</h2>
            <p className="auth-lead">
              Thieves and hijacked accounts almost always do something that person has never done: a new destination, an
              odd hour, far more than usual, something few people in the company ever touch. Build Alice’s day and watch
              the score.
            </p>
          </div>
          <RiskModelDemo />
        </section>

        <section id="thinking" className="section auth-section">
          <div className="auth-section__head">
            <p className="eyebrow">Watch · 3 min · three real cases</p>
            <h2 className="auth-h2">How the model thinks, in dots and flashes</h2>
            <p className="auth-lead">
              Two thousand people, one dot each. Watch the model catch Jack on day one and Laurel on day twenty-one, then
              miss Murphy completely, and see what stops Murphy anyway. Jump to any moment from the list.
            </p>
          </div>
          <ThinkingFilm />
        </section>

        <section id="try" className="section auth-section">
          <div className="auth-section__head">
            <p className="eyebrow">Interactive</p>
            <h2 className="auth-h2">Pick an attacker and a goal</h2>
            <p className="auth-lead">Each outcome below comes from a measured run against the real system.</p>
          </div>
          <AttackSimulator />
        </section>

        <section id="how" className="section auth-section">
          <div className="auth-section__head">
            <p className="eyebrow">How it works</p>
            <h2 className="auth-h2">Six layers that do not trust each other</h2>
            <p className="auth-lead">
              Each layer enforces its own limits, so breaking one never unlocks the next. The decision engine can be hacked
              outright and the vault and gates still hold.
            </p>
          </div>
          <LayerExplorer />
        </section>

        <section id="ceiling" className="section auth-section">
          <div className="auth-section__head">
            <p className="eyebrow">Damage ceiling</p>
            <h2 className="auth-h2">The worst case, as a number</h2>
            <p className="auth-lead">
              Move the slider. This is the most that any combination of compromised accounts could take from a sample
              company, before anyone notices anything.
            </p>
          </div>
          <CeilingCalculator />
        </section>

        <section id="benchmarks" className="section auth-section">
          <div className="auth-section__head">
            <p className="eyebrow">Benchmarks</p>
            <h2 className="auth-h2">Attacked, not just tested</h2>
          </div>
          <h3 className="auth-h3">MITRE ATT&amp;CK techniques</h3>
          <AttackMatrix />
          <div className="auth-two">
            <div>
              <h3 className="auth-h3">AI agent hijacking</h3>
              <AgentBench />
            </div>
            <div>
              <h3 className="auth-h3">Insider detection on real data</h3>
              <DetectionChart />
            </div>
          </div>
          <h3 className="auth-h3">Engineering</h3>
          <dl className="auth-eng">
            <div><dt>Automated tests</dt><dd>129 passing, incl. crash, failover and differential tests</dd></div>
            <div><dt>Fuzzing</dt><dd>50,000 hostile requests: no crash, nothing released</dd></div>
            <div><dt>Dependencies</dt><dd>0 known vulnerabilities (Python and Rust audits)</dd></div>
            <div><dt>Encryption</dt><dd>TLS 1.3 only; no protocol or cipher findings</dd></div>
            <div><dt>Failover</dt><dd>~5–7 s, nothing lost; any one of three referees can fail</dd></div>
            <div><dt>Throughput</dt><dd>~5,500 decisions/s through the front door, 99% in 14 ms</dd></div>
          </dl>
        </section>

        <section id="pricing" className="section auth-section">
          <div className="auth-section__head">
            <p className="eyebrow">Pricing</p>
            <h2 className="auth-h2">Free to run yourself. Paid when you want us in it with you.</h2>
            <p className="auth-lead">
              The open-source core is free forever. Paid plans add the connectors, the production model, the
              shadow-mode pilot and our time, so you see what Authority would have stopped before it blocks anything.
            </p>
          </div>
          <AuthorityPricing />
        </section>

        <section id="open-source" className="section auth-section">
          <div className="auth-section__head">
            <p className="eyebrow">Open source · research preview</p>
            <h2 className="auth-h2">Don&apos;t trust us. Read it, run it, break it.</h2>
            <p className="auth-lead">
              Everything that sets the ceiling is open source under the AGPL-3.0: the decision engine, the risk model,
              the key vault and its limits. Security you can&apos;t inspect is a promise. This is code.
            </p>
          </div>
          <OpenSourceCard />
        </section>

        <section id="limits" className="section auth-section">
          <div className="auth-section__head">
            <p className="eyebrow">Honest limits</p>
            <h2 className="auth-h2">What it does not cover</h2>
          </div>
          <ul className="auth-limits">
            {NOT_COVERED.map(([a, b]) => (
              <li key={a}><strong>{a}</strong><span>{b}</span></li>
            ))}
          </ul>
        </section>

        <p className="auth-footnote auth-preview-note">
          Research preview. Results measured on test deployments and public datasets (CERT insider threat, LANL,
          AgentDojo), not yet on production traffic. The core is open source under the AGPL-3.0:{' '}
          <a href="https://github.com/mastyf-ai/mastyf-authority" target="_blank" rel="noopener noreferrer">github.com/mastyf-ai/mastyf-authority</a>
          . Enterprise add-ons and commercial licences: <Link href="/pilot">talk to us</Link>.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
