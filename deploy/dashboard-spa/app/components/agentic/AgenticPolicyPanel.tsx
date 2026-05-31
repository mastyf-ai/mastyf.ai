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

  if (loading && !data) return <p className="hint p-6">Loading policy &amp; compliance…</p>;

  return (
    <div className="agentic-panel space-y-4">
      <h2 className="text-xl font-bold">Policy &amp; Compliance</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Policy observation"
          value={pg?.active ? 'Active' : 'Idle'}
          sub={`${pg?.totalCalls ?? 0} calls · ${pg?.uniqueTools ?? 0} tools`}
        />
        <KpiCard label="Compliance overall" value={data?.compliance?.overall ?? 0} unit="%" />
        <KpiCard label="Observation uptime" value={pg?.uptimeMin ?? 0} unit="min" />
        <KpiCard label="Frameworks" value={frameworks.length} />
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
