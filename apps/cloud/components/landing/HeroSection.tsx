'use client';

import Link from 'next/link';
import { GITHUB_REPO_URL } from '@/lib/github-links';
import { PAPER_PDF_URL, ZENODO_DOI } from '@/lib/product-links';
import { UnifiedCommandDeck } from './UnifiedCommandDeck';
import { HERO_HEADLINE, HERO_LEAD, HERO_TRUST_ITEMS } from './stats';

type Props = {
  session: boolean;
};

export function HeroSection({ session }: Props) {
  return (
    <header className="lp-hero lp-hero-modern" id="top">
      {/* Subtle Radial Glow */}
      <div className="lp-hero-ambient-glow" />

      <div className="lp-hero-container">
        {/* Top Published Treatise Badge */}
        <div className="lp-hero-badge-wrap">
          <Link
            href="/research"
            className="lp-treatise-badge"
          >
            <span className="lp-treatise-sparkle">✨</span>
            <span className="lp-treatise-prefix">Published Treatise:</span>
            <span className="lp-treatise-text">
              Formal Capability-Mediated Perimeters (Zenodo DOI: {ZENODO_DOI})
            </span>
            <span className="lp-treatise-arrow">→</span>
          </Link>
        </div>

        {/* Editorial Headline */}
        <h1 className="lp-hero-heading">
          {HERO_HEADLINE.line1}
          <br />
          <span className="lp-hero-heading-gradient">{HERO_HEADLINE.line2}</span>
        </h1>

        {/* Subtitle */}
        <p className="lp-hero-sub">
          The hardware-grade execution reference monitor for agentic AI. Sub-microsecond capability mediation, DIFC taint tracking, and deterministic wire severance before malicious MCP tools can execute.
        </p>

        {/* CTA Buttons */}
        <div className="lp-hero-actions">
          <Link href="/download" className="btn btn-primary btn-pill lp-hero-primary-btn font-bold">
            Download Shield (Mac, Win, Linux) →
          </Link>
          <Link href="/developers" className="btn btn-secondary btn-pill">
            Protect an Agent (CLI)
          </Link>
          <a
            href={PAPER_PDF_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-pill"
          >
            Read Paper (PDF) ↗
          </a>
        </div>

        {/* Minimal Trust Strip */}
        <div className="lp-hero-micro-trust">
          {HERO_TRUST_ITEMS.map((item) => (
            <a key={item.label} href={item.href} className="lp-micro-trust-item">
              <span className="lp-trust-check">✓</span>
              <span>{item.label}</span>
            </a>
          ))}
        </div>

        {/* Grand Single Centerpiece */}
        <div className="lp-hero-centerpiece">
          <UnifiedCommandDeck />
        </div>
      </div>
    </header>
  );
}
