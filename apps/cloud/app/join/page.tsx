import { SiteFooter } from '@/components/SiteFooter';
import { SiteNav } from '@/components/SiteNav';
import { JoinDownload } from '@/components/team/JoinDownload';
import { safeAuth } from '@/lib/safe-auth';

export const metadata = {
  title: 'Join your team — Mastyf',
  description: 'Download Mastyf Shield and join the workspace your team lead added you to.',
};

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const [session, { email }] = await Promise.all([safeAuth(), searchParams]);
  return (
    <>
      <SiteNav session={!!session} />
      <main className="page-main">
        <header className="page-head">
          <h1 className="page-head__title">Join your team</h1>
          <p className="page-head__lead">
            Your team lead added you to their Mastyf workspace. Enter the email they added and the code we sent you to
            download Shield.
          </p>
        </header>
        <JoinDownload initialEmail={typeof email === 'string' ? email : ''} />
      </main>
      <SiteFooter />
    </>
  );
}
