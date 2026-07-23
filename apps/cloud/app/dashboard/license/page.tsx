import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getUserOrg } from '@/lib/org-context';
import { sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';

export default async function LicensePage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const ctx = await getUserOrg(session.user.id);
  if (!ctx) redirect('/post-login');
  const db = getDb();

  const licResult: any = await db.execute(sql`
    SELECT * FROM licenses WHERE org_id = ${ctx.org.id} AND revoked_at IS NULL
    ORDER BY activated_at DESC LIMIT 1
  `);
  const lic = ((licResult?.rows || licResult || [])[0]) || {};

  const tier = lic.tier || 'free';
  const tiers = [
    { id: 'free', name: 'Free', instances: 1, teams: 0, users: 1, features: 'Policy, Audit, Dashboard' },
    { id: 'pro', name: 'Pro', instances: 5, teams: 3, users: 10, features: 'All Free + Fleet, Cost, Health, AI, Swarm' },
    { id: 'team', name: 'Team', instances: 25, teams: 10, users: 50, features: 'All Pro + Priority support' },
    { id: 'enterprise', name: 'Enterprise', instances: -1, teams: -1, users: -1, features: 'Unlimited + SSO, Admin, SLA' },
  ];

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 40 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>License</h1>
      <p style={{ color: '#6b7280', marginBottom: 32 }}>Manage your organization&apos;s license tier</p>

      <div style={{ padding: 24, background: tier === 'free' ? '#fef3c7' : '#dcfce7', borderRadius: 8, marginBottom: 32, border: `2px solid ${tier === 'free' ? '#f59e0b' : '#16a34a'}` }}>
        <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 4 }}>Current Tier</div>
        <div style={{ fontSize: 32, fontWeight: 700, color: tier === 'free' ? '#92400e' : '#166534', textTransform: 'uppercase' }}>{tier}</div>
        {lic.activated_at && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>Activated: {new Date(lic.activated_at).toLocaleDateString()}</div>}
        {lic.expires_at && <div style={{ fontSize: 12, color: '#6b7280' }}>Expires: {new Date(lic.expires_at).toLocaleDateString()}</div>}
      </div>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>Available Plans</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        {tiers.map(t => (
          <div key={t.id} style={{ padding: 16, background: tier === t.id ? '#eff6ff' : '#fff', border: `2px solid ${tier === t.id ? '#3b82f6' : '#e5e7eb'}`, borderRadius: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>{t.name}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{t.instances === -1 ? 'Unlimited' : t.instances} instances</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{t.teams === -1 ? 'Unlimited' : t.teams} teams</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>{t.users === -1 ? 'Unlimited' : t.users} users</div>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>{t.features}</div>
            {tier === t.id && <div style={{ marginTop: 8, padding: '4px 8px', background: '#3b82f6', color: '#fff', borderRadius: 4, fontSize: 11, textAlign: 'center', fontWeight: 600 }}>Current</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
