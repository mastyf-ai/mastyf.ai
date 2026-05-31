'use client';

import { useState } from 'react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { fetchZeroTrustScore, type ZeroTrustScore } from '@/lib/guardian-api';

export function ZeroTrustPanel() {
  const [agentId, setAgentId] = useState('dashboard-agent');
  const [serverName, setServerName] = useState('filesystem');
  const [toolName, setToolName] = useState('read_file');
  const [score, setScore] = useState<ZeroTrustScore | null>(null);
  const [loading, setLoading] = useState(false);

  async function evaluate() {
    setLoading(true);
    try {
      setScore(
        await fetchZeroTrustScore({
          agentId,
          sessionId: `dash-${Date.now()}`,
          serverName,
          toolName,
          authenticated: true,
        }),
      );
    } catch {
      setScore(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-4 space-y-3">
      <h3 className="font-semibold">Zero-Trust Verification (C3)</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
        <label className="flex flex-col gap-1">
          Agent ID
          <input className="border rounded px-2 py-1" value={agentId} onChange={(e) => setAgentId(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          Server
          <input className="border rounded px-2 py-1" value={serverName} onChange={(e) => setServerName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          Tool
          <input className="border rounded px-2 py-1" value={toolName} onChange={(e) => setToolName(e.target.value)} />
        </label>
      </div>
      <button type="button" className="px-2 py-1 text-xs border rounded disabled:opacity-50" disabled={loading} onClick={() => void evaluate()}>
        {loading ? 'Scoring…' : 'Evaluate trust score'}
      </button>
      {score && (
        <div className="text-sm space-y-1">
          <p>
            Composite: <strong>{score.composite.toFixed(2)}</strong>{' '}
            <Badge tone={score.action === 'allow' ? 'success' : score.action === 'step_up' ? 'warn' : 'danger'}>
              {score.action}
            </Badge>
          </p>
          {score.reason && <p className="text-muted-foreground">{score.reason}</p>}
          <ul className="text-xs grid grid-cols-2 gap-1">
            {Object.entries(score.dimensions).map(([k, v]) => (
              <li key={k}>
                {k}: {(v * 100).toFixed(0)}%
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
