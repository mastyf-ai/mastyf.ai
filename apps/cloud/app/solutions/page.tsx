import { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { DocFlow, type FlowStep } from '@/components/docs/DocVisuals';
import { safeAuth } from '@/lib/safe-auth';
import './solutions.css';

export const metadata: Metadata = {
  title: 'Solutions — Mastyf',
  description:
    'How Mastyf protects MCP servers, coding agents like Claude Code and Cursor, agents that work with databases and business data, and teams that need evidence for an audit.',
};

type Solution = {
  id: string;
  title: string;
  risk: string;
  flow: FlowStep[];
  stops: string[];
  how: { label: string; href: string }[];
};

const SOLUTIONS: Solution[] = [
  {
    id: 'mcp-security',
    title: 'MCP servers',
    risk: 'A tool server you install can return text that hijacks your agent, or quietly change what its tools do.',
    flow: [
      { label: 'MCP server', sub: 'returns a result' },
      { label: 'Mastyf', sub: 'checks calls, results and tool lists', tone: 'check' },
      { label: 'Your agent', sub: 'sees only what passed', tone: 'ok' },
    ],
    stops: ['Hidden instructions in tool results', 'Tools that change after you approved them', 'Calls that read secrets or send data out'],
    how: [
      { label: 'Put the checks in front of any MCP server', href: '/docs/check#mcp' },
      { label: 'Score a package before you install it', href: '/certified' },
    ],
  },
  {
    id: 'coding-agents',
    title: 'Coding agents',
    risk: 'Claude Code, Cursor and Copilot run commands and read files on your machine. A poisoned README or error message can steer them.',
    flow: [
      { label: 'Coding agent', sub: 'wants to run a command' },
      { label: 'Mastyf', sub: 'checks it first', tone: 'check' },
      { label: 'Your machine', sub: 'runs only what is allowed', tone: 'ok' },
    ],
    stops: ['Reading SSH keys and .env files', 'Download-and-run commands and remote shells', 'Pushing code or files to unknown places'],
    how: [
      { label: 'Shield for Claude Code, Cursor and VS Code', href: '/docs/shield#connect' },
      { label: 'Free hooks for GitHub Copilot', href: '/docs/copilot' },
    ],
  },
  {
    id: 'enterprise-agents',
    title: 'Agents with your data',
    risk: 'An agent that queries a database or CRM can be talked into dumping a table or sending records to someone else.',
    flow: [
      { label: 'Your agent', sub: 'queries your data' },
      { label: 'Mastyf', sub: 'checks the query and where data goes', tone: 'check' },
      { label: 'Your database', sub: 'answers safe queries only', tone: 'ok' },
    ],
    stops: ['Bulk dumps and destructive SQL', 'Data from untrusted places flowing out (Shield)', 'Calls to cloud metadata and private addresses'],
    how: [
      { label: 'Add the free checks to your Python agent', href: '/docs/python' },
      { label: 'Any language: the check API', href: '/docs/check#api' },
    ],
  },
  {
    id: 'regulated-industries',
    title: 'Evidence for audits',
    risk: 'When something is blocked, you need to show what happened, and prove the record wasn’t changed afterwards.',
    flow: [
      { label: 'A call is blocked' },
      { label: 'Signed receipt', sub: 'chained to the one before', tone: 'check' },
      { label: 'Your audit', sub: 'JSON or PDF', tone: 'ok' },
    ],
    stops: ['Records edited after the fact', 'Receipts removed from the chain', 'Blocks with no record of why'],
    how: [
      { label: 'How signed receipts work', href: '/docs/shield#receipts' },
      { label: 'What Mastyf guarantees, and what it doesn’t', href: '/docs/security-model#guarantees' },
    ],
  },
];

export default async function SolutionsPage() {
  const session = await safeAuth();

  return (
    <>
      <SiteNav session={!!session} />
      <main className="page-main">
        <header className="page-head">
          <h1 className="page-head__title">Where Mastyf fits</h1>
          <p className="page-head__lead">Four places AI agents get misled, and how Mastyf stops each one.</p>
        </header>

        {SOLUTIONS.map((s) => (
          <section key={s.id} id={s.id} className="section solution" aria-labelledby={`${s.id}-title`}>
            <div className="solution__text">
              <h2 id={`${s.id}-title`}>{s.title}</h2>
              <p className="solution__risk">{s.risk}</p>
              <ul className="solution__stops">
                {s.stops.map((stop) => (
                  <li key={stop}>{stop}</li>
                ))}
              </ul>
              <div className="solution__how">
                {s.how.map((h) => (
                  <Link key={h.href} href={h.href} className="link-icon">
                    {h.label}
                    <ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" />
                  </Link>
                ))}
              </div>
            </div>
            <DocFlow steps={s.flow} label={`${s.title}: where Mastyf sits`} />
          </section>
        ))}

        <section className="section solution-cta">
          <p>Rolling Mastyf out across a team?</p>
          <Link href="/pilot" className="btn btn-luxe btn-lg">
            Plan a 30-day pilot
          </Link>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
