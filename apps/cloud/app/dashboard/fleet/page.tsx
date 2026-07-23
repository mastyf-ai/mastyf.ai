import { LaunchDashboard } from '@/components/LaunchDashboard';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getUserOrg } from '@/lib/org-context';
import { queryFleetThreatGraph } from '@/lib/fleet-threat-graph';
import { sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';

export default async function FleetPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const ctx = await getUserOrg(session.user.id);
  if (!ctx) redirect('/post-login');

  const db = getDb();

  const result: any = await db.execute(sql`
    SELECT instance_id, instance_name, region, version, hostname, status,
           metrics_snapshot, last_heartbeat
    FROM mastyf_ai_fleet_instances
    WHERE org_id = ${ctx.org.id}
    ORDER BY last_heartbeat DESC LIMIT 200
  `);
  const instances = (result?.rows || []) as any[];

  const auditResult: any = await db.execute(sql`
    SELECT coalesce(sum(total_requests),0)::int as total,
           coalesce(sum(blocked_requests),0)::int as blocked,
           coalesce(sum(allowed_requests),0)::int as "allowed",
           coalesce(sum(flagged_requests),0)::int as flagged,
           count(*)::int as periods
    FROM fleet_audit_aggregates WHERE org_id = ${ctx.org.id}
  `);
  const audit = ((auditResult?.rows || [])[0]) || { total: 0, blocked: 0, allowed: 0, flagged: 0, periods: 0 };

  const policyResult: any = await db.execute(sql`
    SELECT version, published_at FROM policy_versions
    WHERE org_id = ${ctx.org.id} ORDER BY version DESC LIMIT 5
  `);
  const policyVersions = (policyResult?.rows || []) as any[];

  let threatGraph: any = null;
  try { threatGraph = await queryFleetThreatGraph(ctx.org.id, 24); } catch {}

  return (
    <main className="dashboard-page">
      <section className="dashboard-section">
        <h1>Fleet</h1>
        <p>Self-hosted proxy instances registered via heartbeat ({instances.length})</p>
        <LaunchDashboard />
        <table className="fleet-table">
          <thead>
            <tr>
              <th>Instance</th>
              <th>Region</th>
              <th>Status</th>
              <th>Version</th>
              <th>Last heartbeat</th>
            </tr>
          </thead>
          <tbody>
            {instances.map((i) => (
              <tr key={i.instance_id}>
                <td>
                  <strong>{i.instance_name || i.instance_id}</strong>
                  <div className="muted">{i.hostname}</div>
                </td>
                <td>{i.region || '—'}</td>
                <td>{i.status}</td>
                <td>{i.version || '—'}</td>
                <td>{new Date(i.last_heartbeat).toLocaleString()}</td>
              </tr>
            ))}
            {instances.length === 0 && (
              <tr>
                <td colSpan={5}>
                  No instances yet. Set <code>MASTYF_AI_CLOUD_API_KEY</code> and{' '}
                  <code>MASTYF_AI_CONTROL_PLANE_URL</code> on your proxy host.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, margin: '24px 0' }}>
          <div style={{ padding: 16, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Total Requests</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{audit.total}</div>
          </div>
          <div style={{ padding: 16, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Blocked</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#dc2626' }}>{audit.blocked}</div>
          </div>
          <div style={{ padding: 16, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Allowed</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#16a34a' }}>{audit.allowed}</div>
          </div>
          <div style={{ padding: 16, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Audit Periods</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{audit.periods}</div>
          </div>
        </div>

        {policyVersions.length > 0 && (
          <>
            <h2>Policy Versions</h2>
            <table className="fleet-table">
              <thead><tr><th>Version</th><th>Published</th></tr></thead>
              <tbody>
                {policyVersions.map((pv: any) => (
                  <tr key={pv.version}>
                    <td>v{pv.version}</td>
                    <td>{new Date(pv.published_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <h2>Fleet threat graph (24h)</h2>
        <p>Anonymized attack signatures aggregated from instance heartbeats — no raw payloads.</p>
        {threatGraph && threatGraph.signatures.length > 0 ? (
          <>
            {threatGraph.alerts.length > 0 && (
              <ul className="fleet-alerts">
                {threatGraph.alerts.map((a: any) => (
                  <li key={a.signatureId}>{a.message}</li>
                ))}
              </ul>
            )}
            <table className="fleet-table">
              <thead>
                <tr>
                  <th>Signature</th>
                  <th>Rule</th>
                  <th>Tool</th>
                  <th>Region</th>
                  <th>Events</th>
                </tr>
              </thead>
              <tbody>
                {threatGraph.signatures.slice(0, 50).map((s: any) => (
                  <tr key={`${s.signature_id}-${s.region}`}>
                    <td><code>{s.signature_id.slice(0, 12)}…</code></td>
                    <td>{s.rule_name}</td>
                    <td>{s.tool_name}</td>
                    <td>{s.region || '—'}</td>
                    <td>{s.event_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="muted">No threat signatures yet — heartbeats include anonymized blocks when instances report activity.</p>
        )}

        <h2>Federated signature hints</h2>
        <p>Cross-instance attack patterns for herd immunity (≥2 instances, no raw payloads).</p>
        {threatGraph && threatGraph.signatures.filter((s: any) => s.instance_count >= 2).length > 0 ? (
          <table className="fleet-table">
            <thead>
              <tr>
                <th>Signature</th>
                <th>Rule</th>
                <th>Tool</th>
                <th>Category</th>
                <th>Instances</th>
                <th>Events</th>
              </tr>
            </thead>
            <tbody>
              {threatGraph.signatures
                .filter((s: any) => s.instance_count >= 2)
                .slice(0, 30)
                .map((s: any) => (
                  <tr key={`hint-${s.signature_id}`}>
                    <td><code>{s.signature_id.slice(0, 12)}…</code></td>
                    <td>{s.rule_name}</td>
                    <td>{s.tool_name}</td>
                    <td>{s.category || '—'}</td>
                    <td>{s.instance_count}</td>
                    <td>{s.event_count}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No federated hints yet — requires multiple instances reporting the same anonymized signature.</p>
        )}
      </section>
    </main>
  );
}
