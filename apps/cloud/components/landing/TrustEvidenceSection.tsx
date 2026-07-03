'use client';

import { useState } from 'react';
import { REPO_STORIES } from './stats';
import { RevealOnScroll } from './RevealOnScroll';

type StoryId = (typeof REPO_STORIES)[number]['id'];

export function TrustEvidenceSection() {
  const [active, setActive] = useState<StoryId>('fleet');
  const story = REPO_STORIES.find((s) => s.id === active)!;

  return (
    <RevealOnScroll mode="flow">
      <section className="lp-section lp-section-contrast lp-trust-section" id="trust">
        <div className="lp-section-header">
          <h2>Trust, compliance, and deployment proof</h2>
          <p>
            Real capabilities from the open-source repo — fleet management, evidence packs, economics
            controls, and human-reviewed threat discovery.
          </p>
        </div>

        <div className="lp-trust-layout">
          <div className="lp-trust-nav" role="tablist" aria-label="Repo-backed stories">
            {REPO_STORIES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={active === s.id}
                className={`lp-trust-nav-item${active === s.id ? ' lp-trust-nav-active' : ''}`}
                onClick={() => setActive(s.id)}
              >
                <span className="lp-trust-nav-label">{s.label}</span>
              </button>
            ))}
          </div>

          <article className="lp-trust-panel card-elevated motion-tab-enter" role="tabpanel">
            <header>
              <h3>{story.title}</h3>
              <p>{story.body}</p>
            </header>
            <ul className="lp-showcase-bullets">
              {story.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            <a href={story.href} className="lp-feature-link" rel="noopener noreferrer">
              Read the docs →
            </a>
          </article>
        </div>

        <div className="lp-trust-band">
          <div className="lp-trust-proof">
            <span className="lp-trust-proof-value">228/228</span>
            <span>Corpus gates · 0 bypasses</span>
          </div>
          <div className="lp-trust-proof">
            <span className="lp-trust-proof-value">6-phase</span>
            <span>Defense Fabric on every call</span>
          </div>
          <div className="lp-trust-proof">
            <span className="lp-trust-proof-value">Helm</span>
            <span>Enterprise &amp; throughput profiles</span>
          </div>
          <div className="lp-trust-proof">
            <span className="lp-trust-proof-value">OWASP</span>
            <span>Attack matrix evidence mapping</span>
          </div>
        </div>
      </section>
    </RevealOnScroll>
  );
}
