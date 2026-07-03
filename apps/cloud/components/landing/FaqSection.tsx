'use client';

import { useState } from 'react';
import { SITE_NAME } from '@/lib/product-links';

const FAQ_ITEMS = [
  {
    q: `What is ${SITE_NAME}?`,
    a: `${SITE_NAME} is perimeter security for AI agents using MCP. It intercepts every tool call, enforces your security policy, blocks violations before execution, and provides trust scores for npm MCP packages — all from one open-source platform.`,
  },
  {
    q: 'How does runtime enforcement work?',
    a: 'Every tool call passes through three layers: pattern detection (regex, microseconds), schema validation (malformed payloads), and optional semantic LLM review (Ollama or cloud). BlockGuard enforces policy synchronously — anything that fails is blocked and logged.',
  },
  {
    q: 'What is the Security Swarm?',
    a: 'Two coordinated swarms: CI Swarm runs on every PR with Scout, Corpus (228 fixtures), Evasion (120+ probes), Parity, and Report agents. Runtime Swarm enforces in production with BlockGuard, InstantLearner, SemanticAuditor, and Calibrator. Four feedback loops connect them.',
  },
  {
    q: 'Do I need an account for trust scores?',
    a: 'No. Package lookup and badge embedding are public and free. Sign in only for the cloud console — policy YAML, API keys, and fleet management.',
  },
  {
    q: 'How do I deploy mastyf.ai?',
    a: 'Docker is the fastest path: clone the repo and run docker compose. Or build from source with ./setup.sh. The proxy and dashboard run at localhost:4000. Connect to the cloud console for hosted policy management.',
  },
  {
    q: 'How do I get help?',
    a: 'Email mastyf.support@gmail.com for support, or open an issue on GitHub.',
  },
];

export function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section className="landing-faq" id="faq">
      <div className="lp-section-header">
        <h2>Your questions, answered</h2>
        <p>Runtime enforcement, trust scores, Security Swarm, and deployment.</p>
      </div>
      <div className="landing-faq-list">
        {FAQ_ITEMS.map((item, i) => {
          const open = openIndex === i;
          return (
            <div key={item.q} className={`landing-faq-item${open ? ' landing-faq-item-open' : ''}`}>
              <button
                type="button"
                className="landing-faq-question"
                aria-expanded={open}
                onClick={() => setOpenIndex(open ? null : i)}
              >
                {item.q}
                <span aria-hidden className="landing-faq-chevron">
                  {open ? '−' : '+'}
                </span>
              </button>
              {open ? <p className="landing-faq-answer">{item.a}</p> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
