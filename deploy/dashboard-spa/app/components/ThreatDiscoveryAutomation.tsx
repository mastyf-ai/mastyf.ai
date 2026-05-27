'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  buildMutatingHeaders,
  fetchThreatAutomationSummary,
  guardianFetch,
  type ThreatAutomationSummary,
} from '@/lib/guardian-api';
function fmt(ts: string | null): string {
  return ts ? new Date(ts).toLocaleString() : 'Never';
}

function statusClass(state: string): string {
  if (state === 'done') return 'status-green';
  if (state === 'failed') return 'status-red';
  if (state === 'running') return 'status-warning';
  return 'status-gray';
}

export function ThreatDiscoveryAutomation() {
  const [state, setState] = useState<ThreatAutomationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { status, error: loadError } = await fetchThreatAutomationSummary();
      if (!status) {
        setError(loadError || 'Failed to load automation summary');
        return;
      }
      setState(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load automation summary');
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
    try {
      const headers = await buildMutatingHeaders();
      await guardianFetch('/api/threat-discovery/scheduler/start', { method: 'POST', headers });
      setActionMessage('Scheduler started.');
    } catch {
      setActionMessage('Could not start scheduler.');
    }
    void load();
  };

  const stopScheduler = async () => {
    try {
      const headers = await buildMutatingHeaders();
      await guardianFetch('/api/threat-discovery/scheduler/stop', { method: 'POST', headers });
      setActionMessage('Scheduler stopped.');
    } catch {
      setActionMessage('Could not stop scheduler.');
    }
    void load();
  };

  if (loading && !state) {
    return <p className="hint">Loading automation panel…</p>;
  }

  if (error) {
    return <p className="status status-error">{error}</p>;
  }

  if (!state) return null;

  const { scheduler, pipeline, promotion } = state;
  const showsZeroPipeline = pipeline.queued === 0 && pipeline.writesThisHour === 0;
  const writes24h = state.learning.counts24h.threat_research_write || 0;
  const schedulerHasHistory = scheduler.totalRuns > 0;
  const idleButBusyHistorically = schedulerHasHistory && writes24h === 0;
  const activeSources = Object.entries(pipeline.sources)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key)
    .join(', ');
  const autoResearch = state.jobs.autoResearch;
  const threatLab = state.jobs.threatLab;
  const minConfidence = Number(state.features.autoResearchConfig.minConfidence ?? 0.75);

  return (
    <section className="threat-discovery-automation" aria-label="Automation Panel">
      <h3>Threat Discovery Automation</h3>
      <p className="hint">
        Configure automated threat research, LLM-driven discovery, and self-sustaining corpus growth.
      </p>

      {actionMessage ? <p className="hint">{actionMessage}</p> : null}

      <div className="card">
        <h4>Recent Activity</h4>
        <div className="row" style={{ gap: '0.75rem', marginTop: '0.5rem' }}>
          <div className="col card" style={{ flex: 1, textAlign: 'center', padding: '0.5rem' }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{state.autoCorpus.total}</div>
            <small>Corpus fixtures</small>
          </div>
          <div className="col card" style={{ flex: 1, textAlign: 'center', padding: '0.5rem' }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{state.autoCorpus.last24h}</div>
            <small>Corpus (24h)</small>
          </div>
          <div className="col card" style={{ flex: 1, textAlign: 'center', padding: '0.5rem' }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{state.threatLab.pending}/{state.threatLab.total}</div>
            <small>Pending review</small>
          </div>
          <div className="col card" style={{ flex: 1, textAlign: 'center', padding: '0.5rem' }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{state.processedFingerprints}</div>
            <small>Processed fingerprints</small>
          </div>
          <div className="col card" style={{ flex: 1, textAlign: 'center', padding: '0.5rem' }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{writes24h}</div>
            <small>Writes (24h)</small>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: '0.75rem' }}>
        <h4>Continuous Pipeline</h4>
        <div className="row" style={{ gap: '1rem', marginTop: '0.5rem' }}>
          <div className="col" style={{ flex: 1 }}>
            <strong>Status:</strong>{' '}
            <span className={scheduler.running ? 'status-green' : 'status-gray'}>
              {scheduler.running ? 'Running' : 'Stopped'}
            </span>
          </div>
          <div className="col" style={{ flex: 2 }}>
            <strong>Last run:</strong>{' '}
            {fmt(scheduler.lastRunAt)}
            {scheduler.lastRunAt && (
              <span className={scheduler.lastRunStatus === 'success' ? 'status-green' : 'status-red'} style={{ marginLeft: '0.5rem' }}>
                {scheduler.lastRunStatus === 'success' ? 'Success' : 'Failed'}
              </span>
            )}
          </div>
          <div className="col" style={{ flex: 1 }}>
            <strong>Total:</strong> {scheduler.totalRuns} runs
          </div>
        </div>
        <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="primary btn-sm"
            onClick={startScheduler}
            disabled={scheduler.running}
          >
            Start Scheduler
          </button>
          <button
            type="button"
            className="secondary btn-sm"
            onClick={stopScheduler}
            disabled={!scheduler.running}
          >
            Stop Scheduler
          </button>
          <button
            type="button"
            className="secondary btn-sm"
            onClick={() => void load()}
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: '0.75rem' }}>
        <h4>Last Runs</h4>
        <div className="row" style={{ gap: '0.75rem', marginTop: '0.5rem' }}>
          <div className="col card" style={{ flex: 1, padding: '0.75rem' }}>
            <strong>Auto Research</strong>
            <div style={{ marginTop: '0.35rem' }}>
              <span className={statusClass(autoResearch.state)}>{autoResearch.state}</span>
              <span className="hint"> · finished {fmt(autoResearch.finishedAt)}</span>
            </div>
            <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span className="badge">{autoResearch.parsed.written}/{autoResearch.parsed.attempted} written</span>
              <span className="badge">duplicate {autoResearch.parsed.skips.duplicate}</span>
              <span className="badge">low confidence {autoResearch.parsed.skips.belowMinConfidence}</span>
            </div>
            <details style={{ marginTop: '0.5rem' }}>
              <summary>Show log tail</summary>
              <pre className="threat-automation-log">{autoResearch.logTail || 'No log lines yet.'}</pre>
            </details>
          </div>
          <div className="col card" style={{ flex: 1, padding: '0.75rem' }}>
            <strong>Threat Lab</strong>
            <div style={{ marginTop: '0.35rem' }}>
              <span className={statusClass(threatLab.state)}>{threatLab.state}</span>
              <span className="hint"> · finished {fmt(threatLab.finishedAt)}</span>
            </div>
            <div style={{ marginTop: '0.5rem' }}>
              <span className="badge">
                wrote authentic {threatLab.parsed.wroteAuthentic ?? 0}
              </span>
            </div>
            <details style={{ marginTop: '0.5rem' }}>
              <summary>Show log tail</summary>
              <pre className="threat-automation-log">{threatLab.logTail || 'No log lines yet.'}</pre>
            </details>
          </div>
        </div>
      </div>

      {idleButBusyHistorically ? (
        <div className="card" style={{ marginTop: '0.75rem' }}>
          <h4>Why Idle?</h4>
          <ul>
            {!promotion.enabled ? <li>Enable `GUARDIAN_AUTO_CORPUS_PROMOTE=true` for automatic promotion.</li> : null}
            {state.features.threatLabMode === 'reactive' ? <li>Threat Lab is reactive; run Security Swarm or switch proactive mode to generate more candidates.</li> : null}
            <li>Most fingerprints may already be deduplicated ({state.processedFingerprints} seen).</li>
            <li>Current minimum confidence is {minConfidence}; lower it if too many candidates are dropped.</li>
          </ul>
        </div>
      ) : null}

      <div className="card" style={{ marginTop: '0.75rem' }}>
        <h4>Live Pipeline (In-Memory)</h4>
        <p className="hint">
          Live proxy queue only (resets on proxy restart). Security analysis scans and batch jobs update Auto
          Research / Overview, not this in-memory counter.
        </p>
        <div className="row" style={{ gap: '1rem', marginTop: '0.5rem' }}>
          <div className="col" style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
              {pipeline.queued}
            </div>
            <small>Queued Events</small>
          </div>
          <div className="col" style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
              {pipeline.writesThisHour} / {pipeline.maxPerHour}
            </div>
            <small>Writes (hour)</small>
          </div>
          <div className="col" style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
              {pipeline.enabled ? 'Enabled' : 'Disabled'}
            </div>
            <small>Pipeline</small>
          </div>
        </div>

        <div style={{ marginTop: '0.5rem' }}>
          <strong>Active Sources:</strong>{' '}
          {activeSources || 'None'}
        </div>

        <div style={{ marginTop: '0.25rem' }}>
          <strong>LLM Status:</strong>{' '}
          <span className={state.llm.ok ? 'status-green' : 'status-red'}>
            {state.llm.ok ? 'Connected' : state.llm.reason || 'Disconnected'}
          </span>
          {state.llm.model ? <span className="hint"> ({state.llm.model})</span> : null}
        </div>
        <div style={{ marginTop: '0.25rem' }}>
          <strong>Auto corpus:</strong> {state.autoCorpus.total} total · {state.autoCorpus.last24h} in last 24h
        </div>
        <div style={{ marginTop: '0.25rem' }}>
          <strong>Processed fingerprints (persistent):</strong> {state.processedFingerprints}
        </div>
        {showsZeroPipeline && (
          <div style={{ marginTop: '0.5rem' }} className="status status-warning">
            Queue and writes are currently idle. This does not mean discovery is broken; use Last Runs and Learning Feed above.
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: '0.75rem' }}>
        <h4>Auto-Corpus Promotion</h4>
        <p className="hint">
          Auto-discovered threats promoted from adversarial-harness → corpus/attacks/ for regression testing.
        </p>
        <div className="row" style={{ gap: '1rem', marginTop: '0.5rem' }}>
          <div className="col" style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
              {promotion.totalPromoted}
            </div>
            <small>Total Promoted</small>
          </div>
          <div className="col" style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
              {promotion.dailyQuota.used} / {promotion.dailyQuota.max}
            </div>
            <small>Daily Quota</small>
          </div>
          <div className="col" style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
              {promotion.enabled ? 'Enabled' : 'Off'}
            </div>
            <small>Enabled</small>
          </div>
        </div>
        {promotion.lastPromotionAt && (
          <div style={{ marginTop: '0.5rem' }}>
            <strong>Last promotion:</strong>{' '}
            {new Date(promotion.lastPromotionAt).toLocaleString()}
          </div>
        )}
        {!promotion.enabled && (
          <div style={{ marginTop: '0.5rem' }} className="status status-warning">
            Set GUARDIAN_AUTO_CORPUS_PROMOTE=true on the server to enable automatic corpus growth.
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: '0.75rem' }}>
        <h4>Learning Feed</h4>
        {state.learning.recent.length === 0 ? (
          <p className="hint">No learning events yet.</p>
        ) : (
          <div style={{ marginTop: '0.5rem' }}>
            {state.learning.recent.map((event) => (
              <div key={`${event.timestamp}-${event.type}`} className="threat-automation-feed-row">
                <span className="hint">{new Date(event.timestamp).toLocaleTimeString()}</span>
                <strong>{event.type}</strong>
                <span>{event.detail}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: '0.75rem' }}>
        <h4>Quick Actions</h4>
        <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="primary btn-sm"
            onClick={async () => {
              try {
                const headers = await buildMutatingHeaders();
                const resp = await guardianFetch('/api/threat-discovery/threat-lab/run', {
                  method: 'POST',
                  headers,
                  body: JSON.stringify({ mode: 'reactive' }),
                });
                const body = (await resp.json().catch(() => ({}))) as { jobId?: string; error?: string };
                if (!resp.ok) {
                  setActionMessage(body.error || `Threat Lab failed (HTTP ${resp.status})`);
                } else {
                  setActionMessage(
                    body.jobId
                      ? `Threat Lab started (${body.jobId.slice(0, 8)}…) — refresh Threat Lab tab when done`
                      : 'Threat Lab start requested.',
                  );
                }
              } catch {
                setActionMessage('Could not start Threat Lab.');
              }
              void load();
            }}
          >
            Run Threat Lab
          </button>
          <button
            type="button"
            className="primary btn-sm"
            onClick={async () => {
              try {
                const headers = await buildMutatingHeaders();
                const resp = await guardianFetch('/api/threat-discovery/auto-research/run', { method: 'POST', headers });
                const body = (await resp.json().catch(() => ({}))) as { jobId?: string };
                setActionMessage(body.jobId ? `Auto Research started (${body.jobId}).` : 'Auto Research start requested.');
              } catch {
                setActionMessage('Could not start Auto Research.');
              }
              void load();
            }}
          >
            Run Auto Research Now
          </button>
        </div>
      </div>
    </section>
  );
}