import Link from 'next/link';
import { observatorySnapshot } from '@/lib/cloud-observatory-store';
import { listPublicCertifications } from '@/lib/industry-standard';

export const dynamic = 'force-dynamic';

export default async function ObservatoryPage() {
  const snap = observatorySnapshot();
  let certs: Awaited<ReturnType<typeof listPublicCertifications>> = [];
  try {
    certs = await listPublicCertifications({ limit: 20 });
  } catch {
    /* optional */
  }

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '2rem 1.5rem', fontFamily: 'system-ui, sans-serif' }}>
      <p style={{ marginBottom: '0.5rem' }}>
        <Link href="/">← MCP Guardian Cloud</Link>
        {' · '}
        <Link href="/benchmarks">Benchmarks</Link>
      </p>
      <h1 style={{ margin: '0 0 0.5rem' }}>MCP Ecosystem Observatory</h1>
      <p style={{ color: '#555', marginBottom: '1.5rem' }}>
        Fleet-wide anonymized telemetry — adoption, threat heat, and block-rate trends across Guardian deployments.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        <MetricCard label="Adoption score" value={String(snap.adoptionScore)} />
        <MetricCard label="Threat heat index" value={String(snap.threatHeatIndex)} />
        <MetricCard label="Avg block rate" value={`${(snap.avgBlockRate * 100).toFixed(0)}%`} />
        <MetricCard label="Servers tracked" value={String(snap.serverCount)} />
      </div>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Top threat classes</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'left' }}>
              <th style={{ padding: '0.5rem' }}>Class</th>
              <th style={{ padding: '0.5rem' }}>Observations</th>
            </tr>
          </thead>
          <tbody>
            {snap.topThreatClasses.map((t) => (
              <tr key={t.cls} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '0.5rem' }}>{t.cls}</td>
                <td style={{ padding: '0.5rem' }}>{t.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 style={{ fontSize: '1.1rem' }}>Certification-backed reputation (B1)</h2>
        <p style={{ color: '#666', fontSize: '0.9rem' }}>
          {certs.length} certified servers in public registry · {snap.contributorCount ?? 0} reputation contributors
        </p>
        {certs.length > 0 && (
          <ul style={{ fontSize: '0.9rem' }}>
            {certs.slice(0, 8).map((c) => (
              <li key={c.id}>
                {c.serverName} — {c.level} ({c.score}/100)
              </li>
            ))}
          </ul>
        )}
      </section>

      <p style={{ marginTop: '2rem', fontSize: '0.8rem', color: '#888' }}>
        Generated {snap.generatedAt}
      </p>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: '1px solid #e5e5e5', borderRadius: 8, padding: '1rem' }}>
      <div style={{ fontSize: '0.85rem', color: '#666' }}>{label}</div>
      <div style={{ fontSize: '1.75rem', fontWeight: 700 }}>{value}</div>
    </div>
  );
}
