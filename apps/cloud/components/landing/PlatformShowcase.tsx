'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { SHOWCASE_TABS } from './stats';
import { RevealOnScroll } from './RevealOnScroll';
import { EnforcementFeedDemo } from './demos/EnforcementFeedDemo';
import { PolicyDiffDemo } from './demos/PolicyDiffDemo';
import { ScoreBreakdownDemo } from './demos/ScoreBreakdownDemo';
import { CostGuardDemo } from './demos/CostGuardDemo';
import { BadgeLookupWidget } from '@/components/BadgeLookupWidget';

type TabId = (typeof SHOWCASE_TABS)[number]['id'];

function ShowcaseDemo({ demo }: { demo?: string }) {
  switch (demo) {
    case 'enforcement':
      return <EnforcementFeedDemo />;
    case 'policy':
      return <PolicyDiffDemo />;
    case 'score':
      return <ScoreBreakdownDemo />;
    case 'cost':
      return <CostGuardDemo />;
    default:
      return null;
  }
}

export function PlatformShowcase() {
  const [active, setActive] = useState<TabId>('enforcement');
  const tab = SHOWCASE_TABS.find((t) => t.id === active)!;
  const hasDemo = 'demo' in tab && tab.demo;

  return (
    <RevealOnScroll mode="tab">
      <section className="lp-section lp-showcase-section" id="product">
        <div className="lp-section-header">
          <span className="lp-pill lp-pill-gold">Unified Product Family</span>
          <h2>One Security Platform. Four Core Control Layers.</h2>
          <p>
            Mastyf provides complete mediation between untrusted agent cognition and privileged execution — combining runtime enforcement, adversarial hardening, MCP trust, and centralized governance.
          </p>
        </div>

        <div className="lp-showcase-tabs" role="tablist" aria-label="Product showcase">
          {SHOWCASE_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active === t.id}
              className={`lp-showcase-tab${active === t.id ? ' lp-showcase-tab-active' : ''}`}
              onClick={() => setActive(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="lp-showcase-panel motion-tab-enter" role="tabpanel" key={active}>
          <div className="lp-showcase-copy">
            <h3>{tab.title}</h3>
            <p>{tab.body}</p>
            <ul className="lp-showcase-bullets">
              {tab.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            {tab.external ? (
              <a href={tab.href} className="lp-feature-link" rel="noopener noreferrer">
                {tab.cta} →
              </a>
            ) : (
              <Link href={tab.href} className="lp-feature-link">
                {tab.cta} →
              </Link>
            )}
          </div>

          <div className="lp-showcase-visual">
            <div className="lp-browser-chrome">
              <span />
              <span />
              <span />
              <span className="lp-browser-url">
                {active === 'scores' ? 'mastyf.ai/certified' : 'mastyf-gateway.local:4000'}
              </span>
            </div>
            <div className="lp-showcase-media">
              {hasDemo ? (
                <div className="lp-showcase-live">
                  <ShowcaseDemo demo={'demo' in tab ? tab.demo : undefined} />
                </div>
              ) : active === 'scores' ? (
                <div className="lp-showcase-live">
                  <BadgeLookupWidget variant="hero" />
                </div>
              ) : 'image' in tab ? (
                <Image
                  src={(tab as { image: string; imageAlt: string }).image}
                  alt={(tab as { image: string; imageAlt: string }).imageAlt}
                  width={1920}
                  height={912}
                  className="lp-showcase-img"
                  priority={active === 'enforcement'}
                />
              ) : null}
            </div>
          </div>
        </div>

        <div className="lp-guard-callout card mt-8">
          <div className="lp-guard-callout-header">
            <span className="lp-pill lp-pill-gold">Subordinate Semantic Engine</span>
            <h3>Mastyf Guard 1.5B (Frozen V6)</h3>
          </div>
          <p className="muted">
            The semantic auditor inside the security perimeter. Governed by the formal invariant:
            <code>A_final = A_struct ∩ A_semantic ⊆ A_struct</code>.
            The learned model can revoke or escalate authority on ambiguous relational calls, but can never synthesize or grant permission. AI can help judge an action — AI never gets to grant itself authority.
          </p>
          <div className="lp-guard-links">
            <a
              href="https://huggingface.co/Rudraneel93/mastyf-guard-1.5b-v2-boundary-sharpened"
              className="text-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              View Frozen V6 on Hugging Face (Revision d59a6aa) →
            </a>
            <Link href="/research" className="text-link">
              Read the Research Paper &amp; Invariant Proofs →
            </Link>
          </div>
        </div>
      </section>
    </RevealOnScroll>
  );
}
