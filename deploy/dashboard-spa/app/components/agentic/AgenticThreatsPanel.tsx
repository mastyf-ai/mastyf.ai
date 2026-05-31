'use client';

import { Card } from '../ui/Card';
import { KpiCard } from '../dashboard/KpiCard';
import { ChainGraphPanel } from './ChainGraphPanel';
import { useAgenticDashboard } from './useAgenticDashboard';

type Props = { refreshKey?: number };

export function AgenticThreatsPanel({ refreshKey = 0 }: Props) {
  const { data, loading } = useAgenticDashboard(refreshKey);
  const inj = data?.promptInjectionStats;
  const mesh = data?.mesh;
  const hp = data?.honeypots;

  if (loading && !data) return <p className="hint p-6">Loading threat defense metrics…</p>;

  return (
    <div className="agentic-panel space-y-4">
      <h2 className="text-xl font-bold">Threats &amp; Defense</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Injection scans"
          value={inj?.totalScans ?? 0}
          sub={`${inj?.totalDetections ?? 0} detections`}
        />
        <KpiCard
          label="Detection rate"
          value={((inj?.detectionRate ?? 0) * 100).toFixed(1)}
          unit="%"
        />
        <KpiCard label="Mesh signatures" value={mesh?.localSignatures ?? 0} sub={mesh?.enabled ? 'Relay on' : 'Disabled'} />
        <KpiCard label="Honeypot captures" value={hp?.totalCaptures ?? 0} sub={`${hp?.active ?? 0} active`} />
      </div>
      <Card className="p-4">
        <h3 className="font-semibold mb-2">Threat mesh</h3>
        <p className="text-sm text-gray-500">
          Local signatures: {mesh?.localSignatures ?? 0} · Pending: {mesh?.pendingSignatures ?? 0} ·
          Status: {mesh?.enabled ? 'enabled' : 'disabled'}
        </p>
      </Card>
      <Card className="p-4">
        <h3 className="font-semibold mb-2">Red team engine</h3>
        <p className="text-sm text-gray-500">
          Run full red-team campaigns from the Tools tab. Base attack library and mutation engine are active when agentic
          container is initialized.
        </p>
      </Card>
      <ChainGraphPanel refreshKey={refreshKey} />
    </div>
  );
}
