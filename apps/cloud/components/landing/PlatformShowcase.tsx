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
          <h2>One platform. Every layer of MCP security.</h2>
          <p>
            Runtime enforcement, policy control, ops visibility, and public trust scores — built
            from the open-source mastyf.ai repo.
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
                {active === 'scores' ? 'mastyf.ai/certified' : 'localhost:4000'}
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
              ) : (
                <Image
                  src={tab.image}
                  alt={tab.imageAlt}
                  width={1920}
                  height={912}
                  className="lp-showcase-img"
                  priority={active === 'enforcement'}
                />
              )}
            </div>
          </div>
        </div>
      </section>
    </RevealOnScroll>
  );
}
