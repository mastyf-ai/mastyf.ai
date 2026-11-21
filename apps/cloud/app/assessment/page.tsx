'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import './assessment.css';

type Option = { id: string; label: string };
type Question = { id: keyof Answers; title: string; many?: boolean; options: Option[] };
type Answers = { connects: string[]; can: string[]; reads: string[]; guard: string[]; tests: string[] };

const QUESTIONS: Question[] = [
  {
    id: 'connects',
    title: 'How does your agent use tools?',
    many: true,
    options: [
      { id: 'mcp', label: 'Through MCP servers' },
      { id: 'functions', label: 'Through function calling in the model’s API' },
      { id: 'http', label: 'Through our own HTTP calls' },
      { id: 'shell', label: 'It runs terminal commands directly' },
    ],
  },
  {
    id: 'can',
    title: 'What can it do?',
    many: true,
    options: [
      { id: 'read', label: 'Read files' },
      { id: 'write', label: 'Change or delete files' },
      { id: 'db', label: 'Change a database' },
      { id: 'shell', label: 'Run terminal commands' },
      { id: 'money', label: 'Move money or make payments' },
      { id: 'send', label: 'Send email or messages' },
    ],
  },
  {
    id: 'reads',
    title: 'What does it read that someone outside could have written?',
    many: true,
    options: [
      { id: 'web', label: 'Web pages and search results' },
      { id: 'email', label: 'Emails or chat messages' },
      { id: 'docs', label: 'Documents people upload' },
      { id: 'apis', label: 'Data from other companies’ APIs' },
      { id: 'none', label: 'Nothing from outside' },
    ],
  },
  {
    id: 'guard',
    title: 'What stops it doing something it shouldn’t?',
    options: [
      { id: 'prompt', label: 'Instructions in its prompt' },
      { id: 'filter', label: 'A filter that checks the conversation' },
      { id: 'human', label: 'A person approves every action' },
      { id: 'none', label: 'Nothing yet' },
    ],
  },
  {
    id: 'tests',
    title: 'Do you test it against attacks?',
    options: [
      { id: 'auto', label: 'Yes, automatically on every change' },
      { id: 'sometimes', label: 'Now and then, by hand' },
      { id: 'none', label: 'No' },
    ],
  },
];

const EMPTY: Answers = { connects: [], can: [], reads: [], guard: [], tests: [] };

const LEVELS = ['Lower', 'High', 'Very high'] as const;

function assess(a: Answers) {
  const risky = a.can.filter((c) => ['write', 'db', 'shell', 'money', 'send'].includes(c));
  const outside = a.reads.filter((r) => r !== 'none');
  let score = 0;
  if (a.can.includes('shell') || a.can.includes('money')) score += 3;
  if (a.can.includes('write') || a.can.includes('db') || a.can.includes('send')) score += 2;
  if (outside.length >= 1) score += 1;
  if (outside.length >= 2) score += 1;
  if (a.guard.includes('prompt') || a.guard.includes('none')) score += 3;
  if (a.guard.includes('filter')) score += 1;
  if (a.tests.includes('none')) score += 2;
  const level = score >= 7 ? 2 : score >= 4 ? 1 : 0;

  const findings: string[] = [];
  if (outside.length > 0 && risky.length > 0) {
    findings.push(
      'Your agent reads text that strangers can write, and it can act on what it reads. A hidden instruction in a web page, email or document could make it ' +
        describe(risky) +
        '.',
    );
  }
  if (a.guard.includes('prompt')) {
    findings.push('Prompt instructions are requests, not locks. A well-written attack can talk the model out of them.');
  }
  if (a.guard.includes('filter')) {
    findings.push('A conversation filter sees what is said, not what the agent then does. An action can slip through even when the words look harmless.');
  }
  if (a.guard.includes('human')) {
    findings.push('Approving every action works until people start clicking yes without reading. Checking each action against rules keeps approvals for the ones that matter.');
  }
  if (a.guard.includes('none')) {
    findings.push('Nothing checks what the agent does before it runs. Whatever the model decides, happens.');
  }
  if (a.tests.includes('none')) {
    findings.push('Without attack tests you won’t know what gets through until it does.');
  }
  if (findings.length === 0) {
    findings.push('Your setup limits what can go wrong. Checking each action against rules still catches the mistakes a model makes on its own.');
  }

  return { level, findings };
}

function describe(actions: string[]): string {
  const words: Record<string, string> = {
    write: 'delete your files',
    db: 'change your database',
    shell: 'run commands on your machine',
    money: 'send money',
    send: 'send your data to someone else',
  };
  const list = actions.map((a) => words[a]).filter(Boolean);
  if (list.length <= 1) return list[0] ?? 'act against you';
  return `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`;
}

export default function AssessmentPage() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>(EMPTY);
  const done = step >= QUESTIONS.length;
  const q = QUESTIONS[Math.min(step, QUESTIONS.length - 1)]!;
  const picked = answers[q.id];

  const choose = (id: string) => {
    if (q.many) {
      setAnswers((prev) => {
        let next = prev[q.id].includes(id) ? prev[q.id].filter((x) => x !== id) : [...prev[q.id], id];
        // "Nothing from outside" can't sit with the other answers.
        if (id === 'none' && next.includes('none')) next = ['none'];
        else next = next.filter((x) => x !== 'none' || id === 'none');
        return { ...prev, [q.id]: next };
      });
    } else {
      setAnswers((prev) => ({ ...prev, [q.id]: [id] }));
      setStep((s) => s + 1);
    }
  };

  const result = done ? assess(answers) : null;

  return (
    <>
      <SiteNav session={false} />
      <main className="page-main">
        <header className="page-head page-head--center">
          <h1 className="page-head__title">How exposed is your agent?</h1>
          <p className="page-head__lead">Five questions. Your answers stay in your browser.</p>
        </header>

        <section className="section section--flush-top assess">
          <div className="assess__progress" aria-hidden="true">
            {QUESTIONS.map((x, i) => (
              <span key={x.id} className={i < step || done ? 'is-done' : i === step ? 'is-now' : ''} />
            ))}
          </div>

          {!done ? (
            <div className="assess__card" key={q.id}>
              <p className="assess__count">
                Question {step + 1} of {QUESTIONS.length}
                {q.many ? ', pick all that apply' : ''}
              </p>
              <h2 className="assess__q">{q.title}</h2>
              <div className="assess__options" role={q.many ? 'group' : 'radiogroup'} aria-label={q.title}>
                {q.options.map((o) => {
                  const on = picked.includes(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role={q.many ? 'checkbox' : 'radio'}
                      aria-checked={on}
                      className={`assess__opt${on ? ' is-on' : ''}`}
                      data-many={q.many ? 'true' : undefined}
                      onClick={() => choose(o.id)}
                    >
                      <span className="assess__mark" aria-hidden="true">
                        {on ? <Check size={13} strokeWidth={3} /> : null}
                      </span>
                      {o.label}
                    </button>
                  );
                })}
              </div>
              <div className="assess__nav">
                {step > 0 ? (
                  <button type="button" className="assess__back" onClick={() => setStep((s) => s - 1)}>
                    <ArrowLeft size={14} strokeWidth={2} aria-hidden="true" />
                    Back
                  </button>
                ) : (
                  <span />
                )}
                {q.many ? (
                  <button
                    type="button"
                    className="btn btn-glass"
                    disabled={picked.length === 0}
                    onClick={() => setStep((s) => s + 1)}
                  >
                    Next
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="assess__card assess__result">
              <h2 className="assess__q">Your exposure</h2>
              <div className="assess__meter" style={{ ['--level' as string]: result!.level }}>
                <div className="assess__track">
                  <span className="assess__dot" />
                </div>
                <div className="assess__levels">
                  {LEVELS.map((l, i) => (
                    <span key={l} className={i === result!.level ? 'is-on' : ''}>
                      {l}
                    </span>
                  ))}
                </div>
              </div>

              <ul className="assess__findings">
                {result!.findings.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>

              <h3 className="assess__next-title">What to do next</h3>
              <div className="assess__next">
                <Link href="/docs/getting-started" className="assess__path">
                  <strong>Add free checks</strong>
                  <span>Check every action your agent takes against rules, on your own machine.</span>
                </Link>
                <Link href="/pilot" className="assess__path">
                  <strong>Run a 30-day pilot with us</strong>
                  <span>Watch, tune, attack and then enforce, on one of your agents.</span>
                </Link>
              </div>

              <button
                type="button"
                className="assess__back"
                onClick={() => {
                  setAnswers(EMPTY);
                  setStep(0);
                }}
              >
                Start again
                <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
