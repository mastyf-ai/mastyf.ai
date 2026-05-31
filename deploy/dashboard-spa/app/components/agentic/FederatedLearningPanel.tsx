'use client';

import { useEffect, useState } from 'react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import {
  aggregateFederatedDeltas,
  fetchFederatedExportBundle,
  fetchFederatedStatus,
  promoteFederatedRollout,
  type FederatedStatus,
} from '@/lib/guardian-api';

type Props = { refreshKey?: number };

export function FederatedLearningPanel({ refreshKey = 0 }: Props) {
  const [status, setStatus] = useState<FederatedStatus | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadStatus() {
    setStatus(await fetchFederatedStatus());
  }

  useEffect(() => {
    void loadStatus();
  }, [refreshKey]);

  async function aggregate() {
    setLoading(true);
    setMsg(null);
    try {
      const d = await aggregateFederatedDeltas(1);
      setMsg(d?.aggregated ? `Aggregated ${d.contributorCount ?? 0} contributor(s)` : 'Nothing to aggregate');
      await loadStatus();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Aggregate failed');
    } finally {
      setLoading(false);
    }
  }

  async function promoteRollout() {
    setLoading(true);
    setMsg(null);
    try {
      const d = await promoteFederatedRollout();
      setMsg(d?.decision ? `Rollout stage: ${d.stage ?? 'unknown'}` : 'Rollout promotion skipped');
      await loadStatus();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Promote failed');
    } finally {
      setLoading(false);
    }
  }

  async function exportBundle() {
    setLoading(true);
    try {
      const bundle = await fetchFederatedExportBundle();
      if (!bundle) return;
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `federated-${status?.activeVersion ?? 'model'}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg('Exported model bundle');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-4 space-y-3">
      <h3 className="font-semibold">Federated Threat Learning (B3)</h3>
      <div className="flex flex-wrap gap-2 items-center text-sm">
        <Badge tone={status?.enabled ? 'success' : 'neutral'}>{status?.enabled ? 'Enabled' : 'Disabled'}</Badge>
        <span className="text-muted-foreground">Model: {status?.activeVersion ?? '—'}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="px-2 py-1 text-xs border rounded disabled:opacity-50" disabled={loading} onClick={() => void aggregate()}>
          Aggregate deltas
        </button>
        <button type="button" className="px-2 py-1 text-xs border rounded disabled:opacity-50" disabled={loading} onClick={() => void promoteRollout()}>
          Promote rollout
        </button>
        <button type="button" className="px-2 py-1 text-xs border rounded disabled:opacity-50" disabled={loading} onClick={() => void exportBundle()}>
          Export bundle
        </button>
      </div>
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </Card>
  );
}
