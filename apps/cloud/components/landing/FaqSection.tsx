'use client';

import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
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
    q: 'Do I need an account to use Mastyf?',
    a: 'No. Mastyf Shield and Mastyf Gateway run entirely on your own local machine or self-hosted infrastructure. You do not need to register a cloud account or send your telemetry to external servers. Simply download Shield or pull the Docker image and activate with your license key.',
  },
  {
    q: 'How do I deploy mastyf.ai?',
    a: 'For developer workstations (protecting Claude Desktop, Cursor, and Windsurf), install Mastyf Shield for macOS (.dmg), Windows (.exe), or Linux (.AppImage / .deb). For server environments and production pipelines, deploy ghcr.io/mastyf-ai/mastyf-gateway as an inline sidecar proxy.',
  },
  {
    q: 'How do I get help?',
    a: 'Email mastyf.support@gmail.com for support, or open an issue on GitHub.',
  },
];

/** The FAQ accordion on its own, for the docs page. */
export function FaqList() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="faq">
      {FAQ_ITEMS.map((item, i) => {
        const open = openIndex === i;
        return (
          <div key={item.q} className={`faq__item${open ? ' is-open' : ''}`}>
            <h3 className="faq__q">
              <button
                type="button"
                id={`faq-q-${i}`}
                aria-expanded={open}
                aria-controls={`faq-a-${i}`}
                onClick={() => setOpenIndex(open ? null : i)}
              >
                {item.q}
                {open ? (
                  <Minus size={15} strokeWidth={1.75} aria-hidden="true" />
                ) : (
                  <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
                )}
              </button>
            </h3>
            {open ? (
              <div className="faq__a" id={`faq-a-${i}`} role="region" aria-labelledby={`faq-q-${i}`}>
                <p>{item.a}</p>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function FaqSection() {
  return (
    <section className="section" id="faq" aria-labelledby="faq-title">
      <div className="section__grid">
        <div className="section__aside">
          <h2 id="faq-title">Your questions, answered</h2>
          <p>Runtime enforcement, trust scores, Security Swarm, and deployment.</p>
        </div>
        <FaqList />
      </div>
    </section>
  );
}
