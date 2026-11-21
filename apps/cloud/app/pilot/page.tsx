import { Metadata } from 'next';
import { Mail } from 'lucide-react';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { safeAuth } from '@/lib/safe-auth';
import './pilot.css';

export const metadata: Metadata = {
  title: '30-day pilot — Mastyf',
  description:
    'Protect one AI agent end to end in 30 days: watch what Mastyf would stop, tune the rules, attack it with our recorded red-team set, then switch on blocking.',
};

const WEEKS = [
  {
    week: 'Week 1',
    title: 'Watch',
    body: 'Mastyf runs beside one of your agents in observe mode. Nothing is blocked; you see everything it would have stopped.',
  },
  {
    week: 'Week 2',
    title: 'Tune',
    body: 'We write rules for your tools together, from what week one showed, so normal work never gets in the way.',
  },
  {
    week: 'Week 3',
    title: 'Attack',
    body: 'We run our recorded red-team attacks against your setup and fix whatever gets through.',
  },
  {
    week: 'Week 4',
    title: 'Enforce',
    body: 'Blocking goes on. Every block gets a signed receipt, and you get a written summary of what was tried and stopped.',
  },
] as const;

const YOU_GET = [
  'A rules file for your agent’s tools',
  'The attacks we ran, and how each one ended',
  'Signed receipts for every block',
  'A written summary for your security team',
] as const;

// Where pilot requests go, as before. The body lists what helps us plan.
const PILOT_MAIL =
  'mailto:rudraneel93@gmail.com?subject=' +
  encodeURIComponent('Mastyf 30-day pilot') +
  '&body=' +
  encodeURIComponent(
    'Company:\nThe agent you want to protect (what it does, which tools it uses):\nRoughly how many tools it connects to:\nWhen you would like to start:\n',
  );

export default async function PilotPage() {
  const session = await safeAuth();

  return (
    <>
      <SiteNav session={!!session} />
      <main className="page-main">
        <header className="page-head">
          <h1 className="page-head__title">A 30-day pilot</h1>
          <p className="page-head__lead">Protect one agent end to end, with us beside you, before rolling Mastyf out.</p>
        </header>

        <section className="section section--flush-top" aria-label="The four weeks">
          <ol className="pilot-weeks">
            {WEEKS.map((w) => (
              <li key={w.week} className="pilot-week">
                <span className="pilot-week__when">{w.week}</span>
                <h2 className="pilot-week__title">{w.title}</h2>
                <p>{w.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="section pilot-end" aria-labelledby="pilot-get-title">
          <div>
            <h2 id="pilot-get-title">What you have at the end</h2>
            <ul className="pilot-get">
              {YOU_GET.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </div>
          <div className="pilot-start">
            <p>Tell us about the agent you want to protect, and we will plan the four weeks with you.</p>
            <a href={PILOT_MAIL} className="btn btn-luxe btn-lg">
              <Mail size={16} strokeWidth={2} aria-hidden="true" />
              Email us to start
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
