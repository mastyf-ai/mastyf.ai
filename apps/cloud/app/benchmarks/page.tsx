import Link from 'next/link';
import { listBenchmarkLeaderboard } from '@/lib/industry-standard';
import { observatorySnapshot } from '@/lib/cloud-observatory-store';
import { CLOUD_NAME } from '@/lib/product-links';

export const dynamic = 'force-dynamic';

function pct(n: number | null): string {
  if (n === null) return 'Unavailable';
  return `${(n * 100).toFixed(1)}%`;
}

export default async function BenchmarksPage() {
  let rows: Awaited<ReturnType<typeof listBenchmarkLeaderboard>> = [];
  let error: string | null = null;
  try {
    rows = await listBenchmarkLeaderboard({ limit: 100 });
  } catch (e: unknown) {
    error = e instanceof Error ? e.message : 'Failed to load leaderboard';
  }

  const observatory = observatorySnapshot();

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '2rem 1.5rem', fontFamily: 'system-ui, sans-serif' }}>
      <p style={{ marginBottom: '0.5rem' }}>
        <Link href="/">← {CLOUD_NAME}</Link>
        {' · '}
        <Link href="/observatory">Ecosystem observatory →</Link>
      </p>
      <h1 style={{ margin: '0 0 0.5rem' }}>Public benchmark leaderboard</h1>
      <p style={{ color: '#555', marginBottom: '1.5rem' }}>
        Community-submitted proxy profiles ranked by block rate (higher is better) and false-positive rate
        (lower is better). Aggregated fleet telemetry feeds the{' '}
        <Link href="/observatory">ecosystem health observatory</Link>.
      </p>

      <section style={{ marginBottom: '2rem', padding: '1rem', background: '#f8f9fa', borderRadius: 8 }}>
        <h2 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem' }}>Observatory snapshot (B2)</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem' }}>
          <div>
            <p style={{ margin: 0, color: '#666', fontSize: '0.85rem' }}>Avg block rate</p>
            <p style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>{pct(observatory.avgBlockRate)}</p>
          </div>
          <div>
            <p style={{ margin: 0, color: '#666', fontSize: '0.85rem' }}>Server count</p>
            <p style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>
              {observatory.serverCount ?? 'Unavailable'}
            </p>
          </div>
          <div>
            <p style={{ margin: 0, color: '#666', fontSize: '0.85rem' }}>Top threat class</p>
            <p style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>
              {observatory.topThreatClasses[0]?.cls ?? '—'}
            </p>
          </div>
        </div>
      </section>

      {error ? (
        <p role="alert" style={{ color: '#b00020' }}>
          {error}
        </p>
      ) : rows.length === 0 ? (
        <p>No benchmark submissions yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'left' }}>
              <th style={{ padding: '0.5rem' }}>Profile</th>
              <th style={{ padding: '0.5rem' }}>Package</th>
              <th style={{ padding: '0.5rem' }}>Block rate</th>
              <th style={{ padding: '0.5rem' }}>FP rate</th>
              <th style={{ padding: '0.5rem' }}>p95 (ms)</th>
              <th style={{ padding: '0.5rem' }}>Version</th>
              <th style={{ padding: '0.5rem' }}>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '0.5rem' }}>{row.profile}</td>
                <td style={{ padding: '0.5rem' }}>{row.packageName ?? '—'}</td>
                <td style={{ padding: '0.5rem' }}>{pct(row.blockRate)}</td>
                <td style={{ padding: '0.5rem' }}>{pct(row.falsePositiveRate)}</td>
                <td style={{ padding: '0.5rem' }}>
                  {row.p95LatencyMs != null ? row.p95LatencyMs.toFixed(1) : '—'}
                </td>
                <td style={{ padding: '0.5rem' }}>{row.mastyfAiVersion ?? '—'}</td>
                <td style={{ padding: '0.5rem' }}>
                  {new Date(row.submittedAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
