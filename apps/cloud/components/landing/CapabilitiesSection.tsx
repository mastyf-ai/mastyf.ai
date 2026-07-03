'use client';

import { useState } from 'react';
import { CAPABILITIES } from './stats';
import { RevealOnScroll } from './RevealOnScroll';

type CapId = (typeof CAPABILITIES)[number]['id'];

export function CapabilitiesSection() {
  const [active, setActive] = useState<CapId>('runtime');
  const cap = CAPABILITIES.find((c) => c.id === active)!;

  return (
    <RevealOnScroll>
      <section className="lp-section lp-section-tint" id="capabilities">
        <div className="lp-section-header">
          <h2>Everything agents need to ship safely</h2>
          <p>Runtime enforcement, policy you control, full visibility, and a swarm that learns.</p>
        </div>

        <div className="lp-cap-grid">
          {CAPABILITIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`lp-cap-card card-elevated${active === c.id ? ' lp-cap-card-active' : ''}`}
              onClick={() => setActive(c.id)}
              aria-pressed={active === c.id}
            >
              <span className="lp-cap-label">{c.label}</span>
              <strong>{c.title}</strong>
              <p>{c.body}</p>
            </button>
          ))}
        </div>

        <div className="lp-cap-detail card-elevated" aria-live="polite">
          <span className="lp-cap-detail-label">{cap.label}</span>
          <h3>{cap.title}</h3>
          <p>{cap.body}</p>
        </div>
      </section>
    </RevealOnScroll>
  );
}
