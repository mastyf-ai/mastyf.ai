'use client';

import { useEffect, useState } from 'react';

interface RugPullEvent {
  id: string;
  serverName: string;
  tenantId: string;
  previousFingerprint: string;
  currentFingerprint: string;
  toolCount: number;
  detectedAt: string;
}

export default function RugPullSection() {
  const [events, setEvents] = useState<RugPullEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/fleet/rug-pull-events?window=168&limit=50');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setEvents(data.events || []);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load');
          setLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <p className="muted">Loading rug-pull events…</p>;
  if (error) return <p className="muted">Rug-pull data unavailable — ensure the proxy is running with tool fingerprinting enabled.</p>;
  if (events.length === 0) {
    return (
      <div className="rugpull-clean">
        <p><strong>✅ No tool-definition drift detected.</strong> All MCP server fingerprints are stable — no OWASP MCP03 violations.</p>
      </div>
    );
  }

  return (
    <div className="rugpull-alerts">
      <p className="rugpull-warning">
        🚨 <strong>{events.length} rug-pull event{events.length !== 1 ? 's' : ''} detected</strong> — tool definitions changed mid-session.
        These servers may have been compromised. Review immediately.
      </p>
      <table className="fleet-table">
        <thead>
          <tr>
            <th>Server</th>
            <th>Previous Fingerprint</th>
            <th>New Fingerprint</th>
            <th>Tools</th>
            <th>Detected</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td><strong>{e.serverName}</strong></td>
              <td><code>{e.previousFingerprint}</code></td>
              <td><code style={{ color: 'var(--danger)' }}>{e.currentFingerprint}</code></td>
              <td>{e.toolCount}</td>
              <td>{new Date(e.detectedAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
