import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getUserOrg } from '@/lib/org-context';
import { sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';

export default async function TeamsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const ctx = await getUserOrg(session.user.id);
  if (!ctx) redirect('/post-login');

  const result = await getDb().execute(sql`
    SELECT t.*, count(tm.user_id)::int as member_count
    FROM teams t LEFT JOIN team_members tm ON t.org_id = tm.org_id AND t.id = tm.team_id
    WHERE t.org_id = ${ctx.org.id}
    GROUP BY t.org_id, t.id ORDER BY t.name
  `);
  const teams = (result as any)?.rows || [];

  // Get fleet instances for policy assignment
  const fleetResult = await getDb().execute(sql`
    SELECT instance_id, instance_name, status, last_heartbeat
    FROM mastyf_ai_fleet_instances
    WHERE org_id = ${ctx.org.id}
    ORDER BY last_heartbeat DESC LIMIT 50
  `);
  const instances = (fleetResult as any)?.rows || [];

  // Get audit summary
  const auditResult = await getDb().execute(sql`
    SELECT coalesce(sum(total_requests),0)::int as total,
           coalesce(sum(blocked_requests),0)::int as blocked,
           coalesce(sum(allowed_requests),0)::int as "allowed",
           count(*)::int as periods
    FROM fleet_audit_aggregates WHERE org_id = ${ctx.org.id}
  `);
  const audit = ((auditResult as any)?.rows || [])[0] || { total: 0, blocked: 0, allowed: 0, periods: 0 };

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 40 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Teams</h1>
      <p style={{ color: '#6b7280', marginBottom: 32 }}>Manage teams and their security policies</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
        <StatCard label="Teams" value={String(teams.length)} />
        <StatCard label="Active Instances" value={String(instances.filter((i: any) => i.status === 'active' || i.status === 'online').length)} />
        <StatCard label="Total Requests" value={String(audit.total || 0)} />
        <StatCard label="Blocked" value={String(audit.blocked || 0)} color="#dc2626" />
      </div>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>Team List</h2>
      {teams.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', background: '#f9fafb', borderRadius: 8, color: '#6b7280' }}>
          No teams yet. Use the API or dashboard to create teams.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {teams.map((team: any) => (
            <div key={team.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{team.name}</div>
                {team.description && <div style={{ fontSize: 13, color: '#6b7280' }}>{team.description}</div>}
              </div>
              <div style={{ fontSize: 13, color: '#6b7280' }}>{team.member_count} members</div>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 16 }}>Fleet Instances</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {instances.map((inst: any) => (
          <div key={inst.instance_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13 }}>
            <span style={{ fontWeight: 500 }}>{inst.instance_name || inst.instance_id}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ color: '#6b7280' }}>{inst.region || '-'}</span>
              <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, background: inst.status === 'active' || inst.status === 'online' ? '#dcfce7' : '#f3f4f6', color: inst.status === 'active' || inst.status === 'online' ? '#16a34a' : '#6b7280' }}>
                {inst.status || 'unknown'}
              </span>
              <span style={{ color: '#9ca3af', fontSize: 11 }}>{inst.last_heartbeat ? new Date(inst.last_heartbeat).toLocaleString() : '-'}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ padding: '20px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || '#111827' }}>{value}</div>
    </div>
  );
}
