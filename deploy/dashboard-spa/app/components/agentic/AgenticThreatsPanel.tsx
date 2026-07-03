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
  const decoys = data?.decoys;
  const unavailable = data?.available === false;

  if (loading && !data) return <p className="hint p-6">Loading threat defense metrics…</p>;

  return (
    <div className="agentic-panel space-y-4">
      <h2 className="text-xl font-bold">Threats &amp; Defense</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Injection scans"
          value={unavailable || !inj ? 'Unavailable' : inj.totalScans}
          sub={unavailable || !inj ? 'No backend data' : `${inj.totalDetections} detections`}
        />
        <KpiCard
          label="Detection rate"
          value={unavailable || !inj ? 'Unavailable' : (inj.detectionRate * 100).toFixed(1)}
          unit={unavailable || !inj ? undefined : '%'}
        />
        <KpiCard label="Mesh signatures" value={unavailable || !mesh ? 'Unavailable' : mesh.localSignatures} sub={unavailable || !mesh ? 'No backend data' : mesh.enabled ? 'Relay on' : 'Disabled'} />
        <KpiCard label="Decoy captures" value={unavailable || !decoys ? 'Unavailable' : decoys.totalCaptures} sub={unavailable || !decoys ? 'No backend data' : `${decoys.active} active`} />
      </div>
      <Card className="p-4">
        <h3 className="font-semibold mb-2">Threat mesh</h3>
        <p className="text-sm text-gray-500">
          {mesh && !unavailable
            ? `Local signatures: ${mesh.localSignatures} · Pending: ${mesh.pendingSignatures} · Status: ${mesh.enabled ? 'enabled' : 'disabled'}`
            : 'Threat mesh data unavailable from backend.'}
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
