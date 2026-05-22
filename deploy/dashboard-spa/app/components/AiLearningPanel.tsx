'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  acceptSuggestion,
  fetchAiBaselines,
  fetchAiReport,
  fetchAiState,
  fetchAiSuggestions,
  fetchAiThreats,
  fetchSemanticOutcomes,
  labelSemanticOutcome,
  pollAiThreats,
  rejectSuggestion,
  rollbackAiLearning,
  type AiSuggestion,
  type SemanticOutcome,
  type ThreatIntelStatus,
} from '@/lib/guardian-api';
import { hasPermission } from '@/lib/dashboard-roles';

type Props = {
  roles?: string[];
  refreshTick?: number;
  onAction?: (msg: string) => void;
};

export function AiLearningPanel({ roles, refreshTick = 0, onAction }: Props) {
  const canAi = hasPermission(roles, 'ai');
  const canMutate = hasPermission(roles, 'policy_mutate');
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [semantic, setSemantic] = useState<SemanticOutcome[]>([]);
  const [aiInitialized, setAiInitialized] = useState(false);
  const [engineState, setEngineState] = useState<Record<string, unknown> | null>(null);
  const [baselines, setBaselines] = useState<unknown[]>([]);
  const [threats, setThreats] = useState<ThreatIntelStatus | null>(null);
  const [threatPollBusy, setThreatPollBusy] = useState(false);
  const [reportSnippet, setReportSnippet] = useState('');

  const refresh = useCallback(async () => {
    const [sug, sem, st, base, thr, rep] = await Promise.all([
      fetchAiSuggestions(),
      fetchSemanticOutcomes(),
      fetchAiState(),
      fetchAiBaselines(),
      fetchAiThreats(),
      fetchAiReport(),
    ]);
    setSuggestions(sug);
    setSemantic(sem);
    setAiInitialized(!!st?.initialized);
    setEngineState(st?.state ?? null);
    setBaselines(base);
    setThreats(thr);
    const snippet = rep?.report ? JSON.stringify(rep.report, null, 2).slice(0, 1500) : '';
    setReportSnippet(snippet);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (refreshTick <= 0) return;
    const t = window.setTimeout(() => void refresh(), 500);
    return () => window.clearTimeout(t);
  }, [refreshTick, refresh]);

  const onAccept = async (s: AiSuggestion) => {
    if (!canMutate) {
      onAction?.('Requires operator role');
      return;
    }
    const ok = await acceptSuggestion(s);
    onAction?.(ok ? `Accepted ${s.ruleName || s.id}` : 'Accept failed');
    if (ok) await refresh();
  };

  const onReject = async (s: AiSuggestion) => {
    if (!canMutate) {
      onAction?.('Requires operator role');
      return;
    }
    const ok = await rejectSuggestion(s);
    onAction?.(ok ? `Rejected ${s.ruleName || s.id}` : 'Reject failed');
    if (ok) await refresh();
  };

  const onLabel = async (id: string, label: 'true_positive' | 'false_positive' | 'ignored') => {
    if (!canAi) {
      onAction?.('Requires admin/ai role');
      return;
    }
    const res = await labelSemanticOutcome({ semanticAuditId: id, label });
    onAction?.(res.ok ? `Labeled ${id} as ${label}` : res.error || 'Label failed');
    if (res.ok) await refresh();
  };

  const onRollback = async () => {
    if (!canAi) {
      onAction?.('Requires admin/ai role');
      return;
    }
    if (!window.confirm('Rollback AI learning snapshots?')) return;
    const res = await rollbackAiLearning();
    onAction?.(res.ok ? 'AI learning rolled back' : res.error || 'Rollback failed');
    if (res.ok) await refresh();
  };

  const formatTs = (iso: string | null | undefined) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  };

  const onPollThreats = async () => {
    if (!canAi) {
      onAction?.('Requires admin/ai role');
      return;
    }
    setThreatPollBusy(true);
    try {
      const res = await pollAiThreats();
      if (res.ok && res.status) {
        setThreats(res.status);
        onAction?.(`Threat intel refreshed (${res.status.threats} known IDs)`);
      } else {
        onAction?.(res.error || 'Threat intel poll failed');
      }
    } finally {
      setThreatPollBusy(false);
    }
  };

  const threatEntries = threats?.entries ?? [];

  return (
    <section>
      <h2>AI learning &amp; semantic audit</h2>
      <p className="hint">Accept/reject suggestions, label semantic outcomes, rollback learning state.</p>

      <div className="btn-row">
        <button type="button" className="secondary" onClick={() => void refresh()}>
          Refresh
        </button>
        {canAi ? (
          <button type="button" className="secondary" onClick={() => void onRollback()}>
            Rollback AI snapshots
          </button>
        ) : null}
      </div>

      {aiInitialized && engineState ? (
        <div className="cards">
          <article className="card">
            <h3>Engine state</h3>
            <p className="metric-inline">
              TP rate: {String(engineState.truePositiveRate ?? '—')} · FP rate:{' '}
              {String(engineState.falsePositiveRate ?? '—')}
            </p>
            <p className="muted">Threshold: {String(engineState.adaptiveThreshold ?? '—')}</p>
          </article>
          <article className="card">
            <h3>Threat intel</h3>
            <p className="metric">{threats?.threats ?? 0} known IDs</p>
            <p className="muted">
              Updated {formatTs(threats?.updated)} · Last poll {formatTs(threats?.lastPollAt)}
            </p>
            <p className="muted">
              {threats?.pollingDisabled
                ? 'Live polling disabled (GUARDIAN_AI_DISABLE_THREAT_POLL=true)'
                : threats?.pollingActive
                  ? 'Live polling active (NVD, OSV, GitHub)'
                  : 'Polling starts on first dashboard load'}
            </p>
          </article>
          <article className="card">
            <h3>Baselines</h3>
            <p className="metric">{baselines.length}</p>
          </article>
        </div>
      ) : (
        <p className="muted">
          AI engine not initialized yet — start the proxy with traffic; learning state appears after policy blocks.
        </p>
      )}

      <div className="btn-row">
        {canAi ? (
          <button
            type="button"
            className="secondary"
            disabled={threatPollBusy || !!threats?.pollingDisabled}
            onClick={() => void onPollThreats()}
          >
            {threatPollBusy ? 'Polling feeds…' : 'Poll threat feeds now'}
          </button>
        ) : null}
      </div>

      <h3>Threat intel catalog</h3>
      {threatEntries.length === 0 ? (
        <p className="muted">No threat feed IDs recorded yet. Use “Poll threat feeds now” or wait for the next scheduled poll.</p>
      ) : (
        <table className="data-table compact">
          <thead>
            <tr>
              <th>ID</th>
              <th>Source</th>
              <th>Severity</th>
              <th>First seen</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {threatEntries.map((entry) => (
              <tr key={entry.id}>
                <td><code>{entry.id}</code></td>
                <td>{entry.source}</td>
                <td>{entry.severity}</td>
                <td>{formatTs(entry.firstSeenAt)}</td>
                <td>{entry.description?.slice(0, 120) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Pending suggestions</h3>
      {suggestions.length === 0 ? (
        <p className="muted">No pending suggestions.</p>
      ) : (
        <ul className="suggestions">
          {suggestions.map((s) => (
            <li key={String(s.id || s.ruleName)}>
              <strong>{s.ruleName || s.id}</strong>
              <span className="muted">
                {' '}
                ({s.source}, {(s.confidence ?? 0) * 100}%)
              </span>
              <p>{s.reason}</p>
              <div className="btn-row">
                <button type="button" disabled={!canMutate} onClick={() => void onAccept(s)}>
                  Accept
                </button>
                <button type="button" className="secondary" disabled={!canMutate} onClick={() => void onReject(s)}>
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h3>Semantic audit outcomes</h3>
      {semantic.length === 0 ? (
        <p className="muted">No semantic audit records (enable GUARDIAN_SEMANTIC_ASYNC).</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Rule</th>
              <th>Label</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {semantic.slice(0, 30).map((r) => (
              <tr key={r.id}>
                <td>{r.toolName || '—'}</td>
                <td>{r.ruleName || '—'}</td>
                <td>{r.label || '—'}</td>
                <td>
                  {canAi ? (
                    <span className="btn-row inline">
                      <button type="button" className="secondary" onClick={() => void onLabel(r.id, 'true_positive')}>
                        TP
                      </button>
                      <button type="button" className="secondary" onClick={() => void onLabel(r.id, 'false_positive')}>
                        FP
                      </button>
                      <button type="button" className="secondary" onClick={() => void onLabel(r.id, 'ignored')}>
                        Ignore
                      </button>
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {reportSnippet ? (
        <>
          <h3>AI report (excerpt)</h3>
          <pre className="code-block">{reportSnippet}</pre>
        </>
      ) : null}
    </section>
  );
}
