import { safeAuth } from '@/lib/safe-auth';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteNav } from '@/components/SiteNav';
import { HeroSection } from '@/components/landing/HeroSection';
import { SeeTheDifference } from '@/components/landing/SeeTheDifference';
import { ProtocolXSim } from '@/components/landing/ProtocolXSim';
import { ExplainerVideo } from '@/components/landing/ExplainerVideo';
import { Preloader } from '@/components/landing/Preloader';
import { ClosingCta, HowItWorks, ProductRow, ProofRow } from '@/components/landing/HomeSections';

export default async function HomePage() {
  const session = await safeAuth();

  return (
    <>
      <Preloader />
      <SiteNav session={!!session} />
      <main id="main">
        <HeroSection session={!!session} />
        <ProtocolXSim />
        <SeeTheDifference />
        <HowItWorks />
        <section className="section overview" id="overview" aria-labelledby="overview-title">
          <div className="overview__copy">
            <p className="eyebrow">Overview — 1:32</p>
            <h2 id="overview-title">Mastyf in ninety seconds</h2>
            <p>How agents act on your systems, what goes wrong without a boundary, and where Mastyf sits.</p>
            <p className="overview__meta">Captions are on screen, so it works with sound off.</p>
          </div>
          <ExplainerVideo />
        </section>
        <ProductRow />
        <ProofRow />
        <ClosingCta />
      </main>
      <SiteFooter />
    </>
  );
}
