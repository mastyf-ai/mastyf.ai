'use client';

import { useState } from 'react';
import {
  CAPABILITIES,
  HOW_IT_WORKS,
  PROBLEM_CARDS,
  THREATS_STOPPED,
} from './stats';
import { RevealOnScroll } from './RevealOnScroll';

export function DifferentiationSection() {
  const [activeCap, setActiveCap] = useState<(typeof CAPABILITIES)[number]['id']>('runtime');

  const cap = CAPABILITIES.find((c) => c.id === activeCap)!;

  return (
    <RevealOnScroll mode="section">
      <section className="lp-section lp-diff-section" id="why">
        <div className="lp-diff-layout">
          <div className="lp-diff-sticky">
            <p className="lp-eyebrow">
              <span className="lp-pill">Why mastyf</span>
            </p>
            <h2>Built for agents that act — not just chat</h2>
            <p className="lp-diff-lead">
              Generic AI firewalls describe risk. mastyf enforces on every MCP tool call with
              repo-backed policy, corpus gates, and a Security Swarm that compounds with every attack.
            </p>
          </div>

          <div className="lp-diff-content">
            <div className="lp-problem-grid lp-problem-compact">
              {PROBLEM_CARDS.map((card) => (
                <article key={card.title} className="lp-problem-card motion-card">
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </article>
              ))}
            </div>

            <div className="lp-cap-interactive">
              <div className="lp-cap-tabs" role="tablist" aria-label="Capabilities">
                {CAPABILITIES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="tab"
                    aria-selected={activeCap === c.id}
                    className={`lp-cap-tab${activeCap === c.id ? ' lp-cap-tab-active' : ''}`}
                    onClick={() => setActiveCap(c.id)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <div className="lp-cap-panel card-elevated motion-tab-enter" role="tabpanel">
                <h3>{cap.title}</h3>
                <p>{cap.body}</p>
              </div>
            </div>

            <ol className="lp-steps lp-steps-inline">
              {HOW_IT_WORKS.map((step) => (
                <li key={step.step} className="lp-step motion-card">
                  <span className="lp-step-num">{step.step}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="lp-threat-pills">
              <span className="lp-threat-pills-label">Threats stopped at runtime</span>
              <ul>
                {THREATS_STOPPED.map((t) => (
                  <li key={t.name} title={t.detail}>
                    {t.name}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>
    </RevealOnScroll>
  );
}
