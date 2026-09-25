'use client';

import Link from 'next/link';
import { ZENODO_DOI } from '@/lib/product-links';

export function ArcadeManifestoBanner() {
  return (
    <section className="lp-section lp-arcade-manifesto-section" aria-label="Security Manifesto">
      <div className="lp-arcade-manifesto-inner">
        <span className="lp-pill lp-pill-gold text-xs mb-3 inline-block">The Architectural Axiom</span>
        <blockquote className="lp-manifesto-quote">
          &ldquo;The model is not the security boundary. The agent proposes. Mastyf authorizes. Infrastructure executes.&rdquo;
        </blockquote>
        <div className="lp-manifesto-author">
          <span className="text-white font-semibold">Rudraneel Das</span>
          <span className="text-slate-500">·</span>
          <Link href="/research" className="text-amber-400 hover:underline">
            Zenodo Monograph (DOI: {ZENODO_DOI}) ↗
          </Link>
        </div>
      </div>
    </section>
  );
}
