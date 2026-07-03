'use client';

import { Card } from '../ui/Card';
import { KpiCard } from '../dashboard/KpiCard';
import { SemanticPolicyPanel } from './SemanticPolicyPanel';
import { ThreatModelPanel } from './ThreatModelPanel';
import { InsurancePanel } from './InsurancePanel';
import { useAgenticDashboard } from './useAgenticDashboard';

type Props = { refreshKey?: number };

export function AgenticPolicyPanel({ refreshKey = 0 }: Props) {
  const { data, loading } = useAgenticDashboard(refreshKey);
  const pg = data?.policyGen;
  const frameworks = data?.compliance?.frameworks ?? [];
  const unavailable = data?.available === false;

  if (loading && !data) return <p className="hint p-6">Loading policy &amp; compliance…</p>;

  return (
    <div className="agentic-panel space-y-4">
      <h2 className="text-xl font-bold">Policy &amp; Compliance</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Policy observation"
          value={unavailable || !pg ? 'Unavailable' : pg.active ? 'Active' : 'Idle'}
          sub={unavailable || !pg ? 'No backend data' : `${pg.totalCalls} calls · ${pg.uniqueTools} tools`}
        />
        <KpiCard label="Compliance overall" value={unavailable || !data?.compliance ? 'Unavailable' : data.compliance.overall} unit={unavailable || !data?.compliance ? undefined : '%'} />
        <KpiCard label="Observation uptime" value={unavailable || !pg ? 'Unavailable' : pg.uptimeMin} unit={unavailable || !pg ? undefined : 'min'} />
        <KpiCard label="Frameworks" value={unavailable ? 'Unavailable' : frameworks.length} />
      </div>
      <Card className="p-4 overflow-x-auto">
        <table className="data-table w-full text-sm">
          <thead>
            <tr>
              <th>Framework</th>
              <th>Posture</th>
              <th>Controls</th>
            </tr>
          </thead>
          <tbody>
            {frameworks.map((f) => (
              <tr key={f.framework}>
                <td>{f.frameworkName}</td>
                <td>
                  <span className="font-mono">{f.postureScore}%</span>
                </td>
                <td>
                  {f.satisfiedControls}/{f.totalControls}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <SemanticPolicyPanel />
      <ThreatModelPanel />
      <InsurancePanel />
    </div>
  );
}
