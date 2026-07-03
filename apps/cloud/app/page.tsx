import { safeAuth } from '@/lib/safe-auth';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteNav } from '@/components/SiteNav';
import { DynamicBackground } from '@/components/landing/DynamicBackground';
import { HeroSection } from '@/components/landing/HeroSection';
import { MetricsStrip } from '@/components/landing/MetricsStrip';
import { PlatformShowcase } from '@/components/landing/PlatformShowcase';
import { DifferentiationSection } from '@/components/landing/DifferentiationSection';
import { InteractiveArchitectureSection } from '@/components/landing/InteractiveArchitectureSection';
import { TrustEvidenceSection } from '@/components/landing/TrustEvidenceSection';
import { CloudCtaSection, CtaSection } from '@/components/landing/CtaSection';
import { FaqSection } from '@/components/landing/FaqSection';
import './landing.css';
import './certified/certified.css';
import './certified/socket-certified.css';

export default async function HomePage() {
  const session = await safeAuth();

  return (
    <div className="landing">
      <DynamicBackground />
      <SiteNav session={!!session} />
      <main>
        <HeroSection session={!!session} />
        <MetricsStrip />
        <PlatformShowcase />
        <DifferentiationSection />
        <InteractiveArchitectureSection />
        <TrustEvidenceSection />
        <CloudCtaSection session={!!session} />
        <FaqSection />
        <CtaSection session={!!session} />
      </main>
      <SiteFooter />
    </div>
  );
}
