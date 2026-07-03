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

  const result = await getDb().execute(sql`
    SELECT instance_id, instance_name, region, version, hostname, status,
           metrics_snapshot, last_heartbeat
    FROM mastyf_ai_fleet_instances
    WHERE org_id = ${ctx.org.id}
    ORDER BY last_heartbeat DESC
    LIMIT 200
  `);

  const instances = result as unknown as Array<{
    instance_id: string;
    instance_name: string | null;
    region: string | null;
    version: string | null;
    hostname: string | null;
    status: string;
    metrics_snapshot: Record<string, unknown> | null;
    last_heartbeat: Date | string;
  }>;

  let threatGraph: Awaited<ReturnType<typeof queryFleetThreatGraph>> | null = null;
  try {
    threatGraph = await queryFleetThreatGraph(ctx.org.id, 24);
  } catch {
    threatGraph = null;
  }

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

        <h2>Fleet threat graph (24h)</h2>
        <p>Anonymized attack signatures aggregated from instance heartbeats — no raw payloads.</p>
        {threatGraph && threatGraph.signatures.length > 0 ? (
          <>
            {threatGraph.alerts.length > 0 && (
              <ul className="fleet-alerts">
                {threatGraph.alerts.map((a) => (
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
                {threatGraph.signatures.slice(0, 50).map((s) => (
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
        {threatGraph && threatGraph.signatures.filter((s) => s.instance_count >= 2).length > 0 ? (
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
                .filter((s) => s.instance_count >= 2)
                .slice(0, 30)
                .map((s) => (
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
