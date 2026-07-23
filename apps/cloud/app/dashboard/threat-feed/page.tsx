import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getUserOrg } from '@/lib/org-context';
import { sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export default async function ThreatFeedPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const ctx = await getUserOrg(session.user.id);
  if (!ctx) redirect('/post-login');

  const result: any = await getDb().execute(sql`
    SELECT * FROM public_threat_feed_entries
    ORDER BY last_seen DESC LIMIT 200
  `);
  const entries = (result?.rows || []) as any[];

  const catResult: any = await getDb().execute(sql`
    SELECT category, count(*)::int as count FROM public_threat_feed_entries
    GROUP BY category ORDER BY count DESC
  `);
  const categories = (catResult?.rows || []) as any[];

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 40 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Community Threat Feed</h1>
      <p style={{ color: '#6b7280', marginBottom: 32 }}>
        Anonymized MCP attack signatures from the community. Subscribe your proxy to auto-receive these.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
        {categories.map((c: any) => (
          <span key={c.category} style={{ padding: '4px 12px', background: '#eff6ff', borderRadius: 14, fontSize: 12, fontWeight: 500, color: '#1e40af' }}>
            {c.category} ({c.count})
          </span>
        ))}
        {categories.length === 0 && <span style={{ color: '#6b7280', fontSize: 13 }}>No entries yet. Contribute via the API.</span>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 600, overflow: 'auto' }}>
        {entries.map((e: any) => (
          <div key={e.signature_hash} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{e.tool_pattern}</div>
              <div style={{ color: '#6b7280', fontSize: 11 }}>{e.block_reason || e.category}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 10, background: '#fef3c7', color: '#92400e' }}>{e.category}</span>
              <span style={{ color: '#9ca3af', fontSize: 11 }}>{e.report_count} reports</span>
              <span style={{ color: '#d1d5db', fontSize: 10 }}>{new Date(e.last_seen).toLocaleDateString()}</span>
            </div>
          </div>
        ))}
        {entries.length === 0 && (
          <div style={{ textAlign: 'center', padding: 32, color: '#6b7280' }}>No threat feed entries. Contribute via POST /api/v1/threat-feed</div>
        )}
      </div>

      <div style={{ marginTop: 32, padding: 16, background: '#f9fafb', borderRadius: 8, fontSize: 13, color: '#6b7280' }}>
        <strong>Subscribe from your proxy:</strong><br />
        Set <code style={{ fontSize: 11, background: '#e5e7eb', padding: '2px 4px', borderRadius: 3 }}>MASTYF_AI_THREAT_FEED_URL</code> to this endpoint and your proxy will receive new threat signatures automatically.
        <br /><br />
        <strong>API Endpoint:</strong> <code style={{ fontSize: 11, background: '#e5e7eb', padding: '2px 4px', borderRadius: 3 }}>GET /api/v1/threat-feed?action=entries</code>
      </div>
    </div>
  );
}
