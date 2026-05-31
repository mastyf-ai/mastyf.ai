'use client';

import { useEffect, useState } from 'react';
import { Card } from '../ui/Card';

type Anomaly = { agentId: string; anomalyScore: number; reason: string; createdAt: string };

export function BiometricsPanel() {
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);

  useEffect(() => {
    void fetch('/api/agentic/biometrics/anomalies')
      .then((r) => r.json())
      .then((d: { anomalies: Anomaly[] }) => setAnomalies(d.anomalies ?? []))
      .catch(() => {});
  }, []);

  return (
    <Card className="p-4 space-y-2">
      <h3 className="font-semibold">Agent Behavioral Biometrics (A3)</h3>
      <ul className="text-sm space-y-1 max-h-40 overflow-y-auto">
        {anomalies.map((a, i) => (
          <li key={`${a.agentId}-${i}`}>
            {a.agentId}: {(a.anomalyScore * 100).toFixed(0)}% — {a.reason}
          </li>
        ))}
        {!anomalies.length && <li className="text-muted-foreground">No anomalies recorded.</li>}
      </ul>
    </Card>
  );
}
