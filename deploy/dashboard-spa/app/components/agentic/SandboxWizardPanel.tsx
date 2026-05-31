'use client';

import { useState } from 'react';
import { Card } from '../ui/Card';

type Scorecard = {
  goNoGo: 'go' | 'no-go' | 'review';
  attackBlockRate: number;
  workflowPreservation: number;
  latencyDeltaPct: number;
  summary: string;
};

export function SandboxWizardPanel() {
  const [attacksBlocked, setAttacksBlocked] = useState(90);
  const [attacksTotal, setAttacksTotal] = useState(100);
  const [workflowsPreserved, setWorkflowsPreserved] = useState(98);
  const [workflowsTotal, setWorkflowsTotal] = useState(100);
  const [baselineP99, setBaselineP99] = useState(100);
  const [sandboxP99, setSandboxP99] = useState(120);
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [loading, setLoading] = useState(false);
  const [capturedOnly, setCapturedOnly] = useState(false);
  const [lastCapturedReplayed, setLastCapturedReplayed] = useState<number | null>(null);
  const [lastCapturedPassRate, setLastCapturedPassRate] = useState<number | null>(null);

  async function runScorecard() {
    setLoading(true);
    try {
      const res = await fetch('/api/agentic/digital-twin/scorecard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attacksBlocked,
          attacksTotal,
          workflowsPreserved,
          workflowsTotal,
          baselineP99Ms: baselineP99,
          sandboxP99Ms: sandboxP99,
        }),
      });
      setScorecard(await res.json() as Scorecard);
    } catch {
      setScorecard(null);
    } finally {
      setLoading(false);
    }
  }

  async function runReplayHarness() {
    setLoading(true);
    try {
      const res = await fetch('/api/agentic/digital-twin/replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverName: 'filesystem',
          baselineP99Ms: baselineP99,
          sandboxP99Ms: sandboxP99,
          maxSamples: 100,
          capturedTrafficOnly: capturedOnly,
        }),
      });
      const data = await res.json() as {
        replay: {
          attacksBlocked: number;
          attacksTotal: number;
          workflowsPreserved: number;
          workflowsTotal: number;
          capturedReplayed: number;
          capturedPassRate?: number;
        };
        scorecard: Scorecard;
      };
      setAttacksBlocked(data.replay.attacksBlocked);
      setAttacksTotal(data.replay.attacksTotal);
      setWorkflowsPreserved(data.replay.workflowsPreserved);
      setWorkflowsTotal(data.replay.workflowsTotal);
      setLastCapturedReplayed(data.replay.capturedReplayed);
      setLastCapturedPassRate(data.replay.capturedPassRate ?? null);
      setScorecard(data.scorecard);
    } catch {
      setScorecard(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-4 space-y-3">
      <h3 className="font-semibold">Digital Twin Sandbox Wizard (A2)</h3>
      <p className="text-sm text-muted-foreground">
        Replay adversarial corpus against sandbox tier — go/no-go before production rollout.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
        <label className="flex flex-col gap-1">
          Attacks blocked
          <input type="number" className="border rounded px-2 py-1" value={attacksBlocked} onChange={(e) => setAttacksBlocked(Number(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1">
          Attacks total
          <input type="number" className="border rounded px-2 py-1" value={attacksTotal} onChange={(e) => setAttacksTotal(Number(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1">
          Workflows preserved
          <input type="number" className="border rounded px-2 py-1" value={workflowsPreserved} onChange={(e) => setWorkflowsPreserved(Number(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1">
          Workflows total
          <input type="number" className="border rounded px-2 py-1" value={workflowsTotal} onChange={(e) => setWorkflowsTotal(Number(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1">
          Baseline p99 (ms)
          <input type="number" className="border rounded px-2 py-1" value={baselineP99} onChange={(e) => setBaselineP99(Number(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1">
          Sandbox p99 (ms)
          <input type="number" className="border rounded px-2 py-1" value={sandboxP99} onChange={(e) => setSandboxP99(Number(e.target.value))} />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={capturedOnly} onChange={(e) => setCapturedOnly(e.target.checked)} />
        Captured traffic only (skip adversarial corpus)
      </label>
      {lastCapturedReplayed != null && (
        <p className="text-xs text-muted-foreground">
          Last replay: {lastCapturedReplayed} captured call(s)
          {lastCapturedPassRate != null ? ` · pass rate ${lastCapturedPassRate.toFixed(0)}%` : ''}
        </p>
      )}
      <button
        type="button"
        className="px-3 py-1.5 rounded border text-sm disabled:opacity-50 mr-2"
        disabled={loading}
        onClick={() => void runReplayHarness()}
      >
        Run corpus replay harness
      </button>
      <button
        type="button"
        className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm disabled:opacity-50"
        disabled={loading}
        onClick={() => void runScorecard()}
      >
        {loading ? 'Scoring…' : 'Run go/no-go scorecard'}
      </button>
      {scorecard && (
        <div className="text-sm space-y-1">
          <p className="font-semibold uppercase">{scorecard.goNoGo}</p>
          <p>Block rate: {scorecard.attackBlockRate.toFixed(0)}%</p>
          <p>Workflow preservation: {scorecard.workflowPreservation.toFixed(0)}%</p>
          <p>Latency delta: {scorecard.latencyDeltaPct.toFixed(0)}%</p>
          <p className="text-muted-foreground">{scorecard.summary}</p>
        </div>
      )}
    </Card>
  );
}
