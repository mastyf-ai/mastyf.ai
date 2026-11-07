import { safeAuth } from '@/lib/safe-auth';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteNav } from '@/components/SiteNav';
import { AttackLabSidebar } from './AttackLabSidebar';

/** Same shell as the docs: the site header, an outline sidebar, the page, the footer. */
export default async function AttackLabLayout({ children }: { children: React.ReactNode }) {
  const session = await safeAuth();

  return (
    <>
      <SiteNav session={!!session} />
      <div className="docs">
        <AttackLabSidebar />
        {children}
      </div>
      <SiteFooter />
    </>
  );
}
