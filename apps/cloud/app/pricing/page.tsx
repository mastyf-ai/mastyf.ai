import { Metadata } from 'next';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { DynamicBackground } from '@/components/landing/DynamicBackground';
import { PricingSection } from '@/components/landing/PricingSection';
import { FaqSection } from '@/components/landing/FaqSection';
import { safeAuth } from '@/lib/safe-auth';
import '../landing.css';

export const metadata: Metadata = {
  title: 'Pricing & Licensing — Mastyf AI Agent Security Platform',
  description:
    'Transparent, institutional pricing for AI agent security. Self-host the open-source Gateway for free, or govern agent fleets with enterprise Control Plane and continuous adversarial testing.',
};

export default async function PricingPage() {
  const session = await safeAuth();

  return (
    <div className="landing">
      <DynamicBackground />
      <SiteNav session={!!session} />
      <main className="pt-24 pb-16">
        <div className="lp-section">
          <PricingSection />
          <FaqSection />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
