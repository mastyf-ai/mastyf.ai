import { DashboardNav } from '@/components/DashboardNav';
import { auth } from '@/lib/auth';
import { getUserOrg } from '@/lib/org-context';
import { provisionFreeOrganization } from '@/lib/provision';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  let ctx = await getUserOrg(session.user.id);
  if (!ctx) {
    const email =
      session.user.email?.trim()
      || `${session.user.id}@oauth.mastyf-ai.local`;
    try {
      await provisionFreeOrganization({
        userId: session.user.id,
        email,
        name: session.user.name,
      });
      ctx = await getUserOrg(session.user.id);
    } catch (err) {
      console.error('[dashboard] provision failed', err);
      return (
        <main className="container">
          <h1>Setup failed</h1>
          <p className="muted">
            Your account signed in, but we could not create your organization. Check database
            connectivity and try again.
          </p>
          <pre className="env-block" style={{ fontSize: '0.8rem' }}>
            {err instanceof Error ? err.message : String(err)}
          </pre>
          <Link href="/login" className="btn" style={{ marginTop: '1rem', display: 'inline-block' }}>
            Back to sign in
          </Link>
        </main>
      );
    }
  }

  if (!ctx) {
    redirect('/login?error=ProvisionFailed');
  }

  return (
    <div className="dashboard-theme">
      <DashboardNav />
      {children}
    </div>
  );
}
