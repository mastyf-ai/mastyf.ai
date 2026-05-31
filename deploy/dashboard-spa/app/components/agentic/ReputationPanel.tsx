'use client';

import { useState } from 'react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { queryServerReputation, syncReputationMesh, type ReputationEntry } from '@/lib/guardian-api';

export function ReputationPanel() {
  const [serverName, setServerName] = useState('filesystem');
  const [entry, setEntry] = useState<ReputationEntry | null>(null);
  const [meshIngested, setMeshIngested] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function query(networkFetch = true) {
    setLoading(true);
    setError(null);
    try {
      setEntry(await queryServerReputation(serverName, networkFetch));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Query failed');
    } finally {
      setLoading(false);
    }
  }

  async function syncMesh() {
    setLoading(true);
    setError(null);
    try {
      setMeshIngested(await syncReputationMesh());
      await query(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Mesh sync failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-4 space-y-3">
      <h3 className="font-semibold">Decentralized Reputation Network (B1)</h3>
      <div className="flex flex-wrap gap-2 items-end text-sm">
        <label className="flex flex-col gap-1 flex-1 min-w-[140px]">
          Server name
          <input className="border rounded px-2 py-1" value={serverName} onChange={(e) => setServerName(e.target.value)} />
        </label>
        <button type="button" className="px-2 py-1 text-xs border rounded disabled:opacity-50" disabled={loading} onClick={() => void query(true)}>
          Query (network)
        </button>
        <button type="button" className="px-2 py-1 text-xs border rounded disabled:opacity-50" disabled={loading} onClick={() => void syncMesh()}>
          Sync mesh
        </button>
      </div>
      {meshIngested != null && <p className="text-xs text-muted-foreground">Mesh ingest: {meshIngested} entries</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {entry && (
        <div className="text-sm space-y-1">
          <p>
            <Badge tone="neutral">{entry.level ?? 'unrated'}</Badge>{' '}
            Consensus: <strong>{entry.consensusScore.toFixed(0)}</strong>/100
          </p>
          {entry.dimensions && (
            <ul className="text-xs grid grid-cols-2 gap-1">
              {Object.entries(entry.dimensions)
                .slice(0, 8)
                .map(([k, v]) => (
                  <li key={k}>
                    {k}: {v}
                  </li>
                ))}
            </ul>
          )}
          {entry.attestationJws && <p className="text-xs font-mono truncate">Attestation JWS present</p>}
        </div>
      )}
    </Card>
  );
}
