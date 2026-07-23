'use client';

import { useCallback, useEffect, useState } from 'react';
import { scanPackage, type RegistryScanResult } from '@/lib/mastyf-ai-api';
import { Card } from '../ui/Card';
import { KpiCard } from '../ui/KpiCard';
import { EmptyState } from '../ui/EmptyState';

type Props = {
  refreshKey: number;
};

const GRADE_COLORS: Record<string, string> = {
  'A+': '#22c55e', 'A': '#22c55e', 'B': '#3b82f6', 'C': '#f59e0b', 'D': '#f97316', 'F': '#ef4444',
};

export default function ToolRegistryPanel({ refreshKey }: Props) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<RegistryScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');

  const handleScan = async () => {
    if (!query.trim()) return;
    setScanning(true);
    setError('');
    const r = await scanPackage(query.trim());
    setResult(r);
    setScanning(false);
    if (!r) setError('Scan failed. Check the package name and that the proxy is running.');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="MCP Tool Registry" subtitle="Scan MCP packages for security trust scores">
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleScan()}
            placeholder="e.g., @modelcontextprotocol/server-filesystem"
            style={{ flex: 1, padding: '10px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-primary)', fontSize: 14 }}
          />
          <button onClick={handleScan} disabled={scanning || !query.trim()}
            style={{ padding: '10px 20px', borderRadius: 6, border: 'none', background: scanning ? 'var(--text-muted)' : 'var(--brand-primary)', color: '#fff', cursor: scanning ? 'default' : 'pointer', fontSize: 14, fontWeight: 500 }}>
            {scanning ? 'Scanning…' : 'Scan'}
          </button>
        </div>
        {error && <div style={{ padding: 8, background: 'var(--bg-danger)', borderRadius: 4, fontSize: 13, color: 'var(--brand-danger)', marginBottom: 12 }}>{error}</div>}
      </Card>

      {result && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <KpiCard label="Trust Grade" value={result.trustGrade} accent="info" />
            <KpiCard label="Score" value={`${result.trustScore}/100`} accent="info" />
            <KpiCard label="CVEs" value={String(result.cveCount)} accent={result.criticalCveCount > 0 ? 'danger' : 'neutral'} secondary={result.criticalCveCount > 0 ? `${result.criticalCveCount} critical` : 'None critical'} />
            <KpiCard label="Scanned" value={new Date(result.scannedAt).toLocaleDateString()} accent="neutral" />
          </div>

          <Card title="Security Dimensions">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Object.entries(result.dimensions).map(([key, val]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', width: 140, textTransform: 'capitalize' }}>{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                  <div style={{ flex: 1, height: 8, background: 'var(--bg-muted)', borderRadius: 4 }}>
                    <div style={{ width: `${val}%`, height: '100%', borderRadius: 4, background: val >= 80 ? '#22c55e' : val >= 50 ? '#f59e0b' : '#ef4444', transition: 'width 0.3s' }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', minWidth: 40, textAlign: 'right' }}>{val}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Badge Embed">
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div dangerouslySetInnerHTML={{ __html: `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="20"><rect width="80" height="20" fill="#1f2937" rx="3"/><text x="40" y="14" fill="#f9fafb" font-size="11" font-family="monospace" text-anchor="middle" font-weight="bold">Mastyf ${result.trustGrade}</text><rect x="80" width="60" height="20" fill="${GRADE_COLORS[result.trustGrade] || '#6b7280'}" rx="3"/><text x="110" y="14" fill="#fff" font-size="11" font-family="monospace" text-anchor="middle">${result.trustScore}/100</text></svg>` }} />
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Copy this SVG to your README
                <br />
                <code style={{ fontSize: 10, background: 'var(--bg-muted)', padding: '2px 6px', borderRadius: 3 }}>{`<img src="http://localhost:4000/api/registry/badge.svg?score=${result.trustScore}&grade=${result.trustGrade}" />`}</code>
              </div>
            </div>
          </Card>
        </>
      )}

      {!result && !scanning && (
        <Card>
          <EmptyState title="MCP Server Trust Scanner" message="Enter an npm package name to scan for security posture, CVEs, and generate a trust grade (A+ to F)." />
        </Card>
      )}
    </div>
  );
}
