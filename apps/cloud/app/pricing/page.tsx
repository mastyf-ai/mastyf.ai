import { Metadata } from 'next';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { PricingSection } from '@/components/landing/PricingSection';
import { FreeVsPaid } from '@/components/pricing/FreeVsPaid';
import { developerOfferFor, type DeveloperOffer } from '@/lib/billing/fulfillment';
import { getUserOrg } from '@/lib/org-context';
import { safeAuth } from '@/lib/safe-auth';

export const metadata: Metadata = {
  title: 'Pricing — Mastyf',
  description:
    'Free: the Python library, check service and policy engine on your own servers. Paid: the Shield app with Protocol X, DIFC taint tracking and the mastyf.ai dashboard.',
};

/** The launch offer for this visitor. If it can't be read the page still renders, without a count. */
async function offerForVisitor(userId: string | undefined): Promise<DeveloperOffer | null> {
  try {
    const ctx = userId ? await getUserOrg(userId) : null;
    return await developerOfferFor(ctx?.org.id ?? null);
  } catch {
    return null;
  }
}

export default async function PricingPage() {
  const session = await safeAuth();
  const offer = await offerForVisitor(session?.user?.id);

  return (
    <>
      <SiteNav session={!!session} />
      <main className="page-main">
        <header className="page-head">
          <h1 className="page-head__title">Pricing</h1>
          <p className="page-head__lead">
            Free runs on your own servers. Paid adds the Shield app and Mastyf&rsquo;s hosted protection.
          </p>
        </header>
        <PricingSection signedIn={!!session} offer={offer} />
        <FreeVsPaid />
      </main>
      <SiteFooter />
    </>
  );
}
