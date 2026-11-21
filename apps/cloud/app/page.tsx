import { safeAuth } from '@/lib/safe-auth';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteNav } from '@/components/SiteNav';
import { HeroSection } from '@/components/landing/HeroSection';
import { AgentStory } from '@/components/landing/AgentStory';
import { HowItWorksScroll } from '@/components/landing/HowItWorksScroll';
import { SignedReceipts } from '@/components/landing/SignedReceipts';
import { WorksWithRibbon } from '@/components/landing/WorksWithRibbon';
import { ExplainerVideo } from '@/components/landing/ExplainerVideo';
import { Preloader } from '@/components/landing/Preloader';
import { ClosingCta, ProductRow, ProofRow } from '@/components/landing/HomeSections';

export default async function HomePage() {
  const session = await safeAuth();

  return (
    <>
      <Preloader />
      <SiteNav session={!!session} />
      <main id="main" className="home">
        <HeroSection session={!!session} />
        <WorksWithRibbon />
        <HowItWorksScroll />
        <section className="section" id="see-it" aria-labelledby="story-title">
          <header className="sec-head">
            <h2 id="story-title">What happens when someone tricks your AI</h2>
          </header>
          <AgentStory />
        </section>
        <SignedReceipts />
        <section className="section overview" id="overview" aria-labelledby="overview-title">
          <header className="sec-head">
            <h2 id="overview-title">Mastify your agents.</h2>
          </header>
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
