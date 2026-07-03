import { SiteFooter } from '@/components/SiteFooter';
import { SiteNav } from '@/components/SiteNav';
import { DynamicBackground } from '@/components/landing/DynamicBackground';
import { safeAuth } from '@/lib/safe-auth';

type Props = { children: React.ReactNode };

export async function CertifiedShell({ children }: Props) {
  const session = await safeAuth();

  return (
    <div className="socket-shell landing">
      <DynamicBackground />
      <SiteNav session={!!session} />
      {children}
      <SiteFooter />
    </div>
  );
}
