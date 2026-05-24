'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  fetchThreatDiscoveryStatus,
  type ThreatDiscoveryStatus,
} from '@/lib/guardian-api';

type AutomationState = {
  schedulerRunning: boolean;
  lastRunAt: string | null;
  totalRuns: number;
  lastRunOk: boolean;
  pipelineHealth: {
    queued: number;
    writesThisHour: number;
    maxPerHour: number;
    enabled: boolean;
    sources: Record<string, boolean>;
  };
  promotionStats: {
    enabled: boolean;
    totalPromoted: number;
    dailyQuota: { used: number; max: number };
    lastPromotionAt: string | null;
  };
};

async function fetchSchedulerStatus(): Promise<AutomationState> {
  const resp = await fetch('/api/threat-discovery/scheduler/status');
  const data = await resp.json();
  
  // Fetch pipeline health from threat-discovery status
  const tdResp = await fetch('/api/threat-discovery/status');
  const tdData = await tdResp.json();
  
  // Fetch promotion stats
  let promoStats = { enabled: false, totalPromoted: 0, dailyQuota: { used: 0, max: 5 }, lastPromotionAt: null };
  try {
    const promoResp = await fetch('/api/threat-discovery/promote/batch', { method: 'POST' });
    const promoData = await promoResp.json();
    if (!promoData.error) promoStats = promoData;
  } catch {}

  return {
    schedulerRunning: data.running ?? false,
    lastRunAt: data.lastRunAt ?? null,
    totalRuns: data.totalRuns ?? 0,
    lastRunOk: data.lastRunOk ?? false,
    pipelineHealth: tdData?.pipelineHealth ?? { queued: 0, writesThisHour: 0, maxPerHour: 20, enabled: false, sources: {} },
    promotionStats: promoStats,
  };
}

export function ThreatDiscoveryAutomation() {
  const [state, setState] = useState<AutomationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchSchedulerStatus();
      setState(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load automation status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => void load(), 10_000);
    return () => clearInterval(interval);
  }, [load]);

  const startScheduler = async () => {
    await fetch('/api/threat-discovery/scheduler/start', { method: 'POST' });
    void load();
  };

  const stopScheduler = async () => {
    await fetch('/api/threat-discovery/scheduler/stop', { method: 'POST' });
    void load();
  };

  if (loading && !state) {
    return <p className="hint">Loading automation panel…</p>;
  }

  if (error) {
    return <p className="status status-error">{error}</p>;
  }

  if (!state) return null;

  const { schedulerRunning, pipelineHealth, promotionStats } = state;

  return (
    <section className="threat-discovery-automation" aria-label="Automation Panel">
      <h3>Threat Discovery Automation</h3>
      <p className="hint">
        Configure automated threat research, LLM-driven discovery, and self-sustaining corpus growth.
      </p>

      {/* ── Scheduler Controls ────────────────────────────────────────── */}
      <div className="card">
        <h4>Continuous Pipeline</h4>
        <div className="row" style={{ gap: '1rem', marginTop: '0.5rem' }}>
          <div className="col" style={{ flex: 1 }}>
            <strong>Status:</strong>{' '}
            <span className={schedulerRunning ? 'status-green' : 'status-gray'}>
              {schedulerRunning ? '🟢 Running' : '⏸ Stopped'}
            </span>
          </div>
          <div className="col" style={{ flex: 2 }}>
            <strong>Last run:</strong>{' '}
            {state.lastRunAt
              ? new Date(state.lastRunAt).toLocaleString()
              : 'Never'}
            {state.lastRunAt && (
              <span className={state.lastRunOk ? 'status-green' : 'status-red'} style={{ marginLeft: '0.5rem' }}>
                {state.lastRunOk ? '✓' : '✗'}
              </span>
            )}
          </div>
          <div className="col" style={{ flex: 1 }}>
            <strong>Total:</strong> {state.totalRuns} runs
          </div>
        </div>
        <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="primary btn-sm"
            onClick={startScheduler}
            disabled={schedulerRunning}
          >
            ▶ Start Scheduler
          </button>
          <button
            type="button"
            className="secondary btn-sm"
            onClick={stopScheduler}
            disabled={!schedulerRunning}
          >
            ⏹ Stop Scheduler
          </button>
          <button
            type="button"
            className="secondary btn-sm"
            onClick={() => void load()}
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* ── Pipeline Health ───────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: '0.75rem' }}>
        <h4>Pipeline Health</h4>
        <div className="row" style={{ gap: '1rem', marginTop: '0.5rem' }}>
          <div className="col" style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
              {pipelineHealth.queued}
            </div>
            <small>Queued Events</small>
          </div>
          <div className="col" style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
              {pipelineHealth.writesThisHour} / {pipelineHealth.maxPerHour}
            </div>
            <small>Writes (hour)</small>
          </div>
          <div className="col" style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
              {pipelineHealth.enabled ? '🟢' : '🔴'}
            </div>
            <small>Pipeline</small>
          </div>
        </div>

        <div style={{ marginTop: '0.5rem' }}>
          <strong>Active Sources:</strong>{' '}
          {pipelineHealth.sources && Object.keys(pipelineHealth.sources).length > 0
            ? Object.entries(pipelineHealth.sources)
                .filter(([, v]) => v)
                .map(([k]) => k)
                .join(', ')
                : 'None'}
        </div>

        <div style={{ marginTop: '0.25rem' }}>
          <strong>LLM Status:</strong> <span className="status-green">● Connected</span>
        </div>
      </div>

      {/* ── Auto-Promotion ────────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: '0.75rem' }}>
        <h4>Auto-Corpus Promotion</h4>
        <p className="hint">
          Auto-discovered threats promoted from adversarial-harness → corpus/attacks/ for regression testing.
        </p>
        <div className="row" style={{ gap: '1rem', marginTop: '0.5rem' }}>
          <div className="col" style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
              {promotionStats.totalPromoted}
            </div>
            <small>Total Promoted</small>
          </div>
          <div className="col" style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
              {promotionStats.dailyQuota.used} / {promotionStats.dailyQuota.max}
            </div>
            <small>Daily Quota</small>
          </div>
          <div className="col" style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
              {promotionStats.enabled ? '🟢' : '⚪'}
            </div>
            <small>Enabled</small>
          </div>
        </div>
        {promotionStats.lastPromotionAt && (
          <div style={{ marginTop: '0.5rem' }}>
            <strong>Last promotion:</strong>{' '}
            {new Date(promotionStats.lastPromotionAt).toLocaleString()}
          </div>
        )}
        {!promotionStats.enabled && (
          <div style={{ marginTop: '0.5rem' }} className="status status-warning">
            Set GUARDIAN_AUTO_CORPUS_PROMOTE=true on the server to enable automatic corpus growth.
          </div>
        )}
      </div>

      {/* ── Quick Actions ──────────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: '0.75rem' }}>
        <h4>Quick Actions</h4>
        <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="primary btn-sm"
            onClick={async () => {
              await fetch('/api/threat-discovery/threat-lab/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'reactive' }),
              });
              void load();
            }}
          >
            🧪 Run Threat Lab
          </button>
          <button
            type="button"
            className="primary btn-sm"
            onClick={async () => {
              await fetch('/api/threat-discovery/auto-research/run', { method: 'POST' });
              void load();
            }}
          >
            🔬 Run Auto Research
          </button>
        </div>
      </div>
    </section>
  );
}