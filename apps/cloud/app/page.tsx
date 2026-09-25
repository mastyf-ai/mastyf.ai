import { safeAuth } from '@/lib/safe-auth';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteNav } from '@/components/SiteNav';
import { AnimatedNebula } from '@/components/landing/AnimatedNebula';
import { ArcadePerspectiveMesh } from '@/components/landing/ArcadePerspectiveMesh';
import { HeroSection } from '@/components/landing/HeroSection';
import { LiveThreatTicker } from '@/components/landing/LiveThreatTicker';
import { EcosystemMarquee } from '@/components/landing/EcosystemMarquee';
import { PlatformBentoGrid } from '@/components/landing/PlatformBentoGrid';
import { MacOSAppShowcase } from '@/components/landing/MacOSAppShowcase';
import { BenchmarkScorecard } from '@/components/landing/BenchmarkScorecard';
import { RoiCalculator } from '@/components/landing/RoiCalculator';
import { PaperSection } from '@/components/landing/PaperSection';
import { PricingSection } from '@/components/landing/PricingSection';
import { FaqSection } from '@/components/landing/FaqSection';
import Link from 'next/link';
import './landing.css';
import './certified/certified.css';
import './certified/socket-certified.css';

export default async function HomePage() {
  const session = await safeAuth();

  return (
    <div className="landing relative overflow-hidden">
      {/* Atmospheric background system */}
      <ArcadePerspectiveMesh />
      <AnimatedNebula />
      <SiteNav session={!!session} />

      <main className="relative z-10">
        {/* 1. Hero: cinematic entry with UnifiedCommandDeck centerpiece */}
        <HeroSection session={!!session} />

        {/* 2. Live Threat Feed Ticker */}
        <LiveThreatTicker />

        {/* 3. Client Ecosystem Marquee */}
        <EcosystemMarquee />

        {/* 4. Platform Bento Grid with interactive gate inspector */}
        <PlatformBentoGrid />

        {/* 5. macOS Native App Showcase */}
        <MacOSAppShowcase />

        {/* 6. ROI Calculator */}
        <RoiCalculator />

        {/* 7. Independent Benchmark Scorecards */}
        <BenchmarkScorecard />

        {/* 8. Academic Monograph & Formal Verification */}
        <PaperSection />

        {/* 9. Pricing */}
        <PricingSection />

        {/* 10. FAQ */}
        <FaqSection />

        {/* Final CTA */}
        <div className="lp-section lp-section-tint text-center py-16" id="get-started">
          <div className="max-w-2xl mx-auto">
            <span className="lp-pill lp-pill-gold mb-3 inline-block">Start Defending in Seconds</span>
            <h2 className="text-3xl font-bold text-white mb-4">
              Stop prompt injection before unauthorized tools execute.
            </h2>
            <p className="text-slate-400 text-sm leading-relaxed mb-6">
              Download the Mastyf Shield desktop appliance for macOS, Windows, and Linux, or deploy the fail-closed Gateway sidecar across your production fleet.
            </p>
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <Link href="/download" className="btn btn-primary btn-pill font-bold shadow-lg shadow-amber-500/20 px-6 py-3">
                Download Mastyf Shield (Mac, Windows, Linux) →
              </Link>
              <Link href="/developers" className="btn btn-secondary btn-pill px-6 py-3">
                Developer CLI Quickstart
              </Link>
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
