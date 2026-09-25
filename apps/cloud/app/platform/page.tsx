import { Metadata } from 'next';
import Link from 'next/link';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { DynamicBackground } from '@/components/landing/DynamicBackground';
import { CapabilityMatrixSection } from '@/components/landing/CapabilityMatrixSection';
import { PRODUCT_FAMILY } from '@/components/landing/stats';
import { safeAuth } from '@/lib/safe-auth';
import '../landing.css';

export const metadata: Metadata = {
  title: 'Product Platform Architecture — Mastyf AI Agent Security',
  description:
    'Explore the Mastyf AI Agent Security Platform: Gateway (runtime enforcement), Swarm (continuous adversarial CI/CD), Trust (MCP intelligence), Control Plane (fleet governance), and Guard (subordinate semantic auditor).',
};

export default async function PlatformPage() {
  const session = await safeAuth();

  return (
    <div className="landing">
      <DynamicBackground />
      <SiteNav session={!!session} />
      <main className="pt-24 pb-16">
        <div className="lp-section">
          <div className="lp-section-header">
            <span className="lp-pill lp-pill-gold">Architectural Platform</span>
            <h1>The Mastyf AI Agent Security Platform</h1>
            <p>
              An externally enforced security layer for AI-agent execution, combining runtime authorization, continuous adversarial testing, software trust, and fleet governance.
            </p>
          </div>

          <div className="my-10 flex flex-col gap-8">
            {PRODUCT_FAMILY.map((prod) => (
              <div key={prod.id} id={prod.id} className="card p-8">
                <div className="flex justify-between items-start flex-wrap gap-2 mb-2">
                  <div>
                    <span className="lp-pill text-xs mb-2 inline-block">{prod.category}</span>
                    <h2 className="text-2xl font-bold text-white">{prod.name}</h2>
                    <p className="text-amber-400 text-sm font-semibold mb-3">{prod.tagline}</p>
                  </div>
                  <span className="lp-pill lp-pill-gold text-xs">{prod.badge}</span>
                </div>

                <p className="text-slate-300 text-sm mb-4 leading-relaxed">{prod.description}</p>

                <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-6">
                  {prod.bullets.map((b) => (
                    <li key={b} className="text-xs text-slate-400 flex items-center gap-2">
                      <span className="text-amber-400 font-bold">✓</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>

                <Link href={prod.href} className="text-link text-sm font-semibold">
                  Learn More About {prod.name} →
                </Link>
              </div>
            ))}
          </div>

          <CapabilityMatrixSection />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
