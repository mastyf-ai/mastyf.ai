'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  acceptSuggestion,
  fetchAiBaselines,
  fetchAiReport,
  fetchAiState,
  fetchAiSuggestions,
  fetchAiThreats,
  fetchQuarantinedThreats,
  fetchActiveLearningReport,
  fetchAgentAbuseScores,
  fetchSemanticOutcomes,
  labelSemanticOutcome,
  pollAiThreats,
  rejectSuggestion,
  quarantineThreatIntel,
  dismissThreatIntel,
  rollbackAiLearning,
  type AiSuggestion,
  type SemanticOutcome,
  type ThreatIntelStatus,
} from '@/lib/guardian-api';
import { IncidentInvestigatorDrawer, type ThreatLabContext } from './IncidentInvestigatorDrawer';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { hasPermission } from '@/lib/dashboard-roles';
import { InsightsNarrativeRail } from './dashboard/InsightsNarrativeRail';
import { DashboardSection } from './dashboard/DashboardSection';
import { KpiCard } from './dashboard/KpiCard';
import { ChartCard } from './dashboard/ChartCard';
import { CHART_COLORS } from '@/lib/chartTheme';

type Props = {
  roles?: string[];
  refreshTick?: number;
  onAction?: (msg: string) => void;
  onOpenThreatLab?: (ctx: ThreatLabContext) => void;
};

export function AiLearningPanel({ roles, refreshTick = 0, onAction, onOpenThreatLab }: Props) {
  const canAi = hasPermission(roles, 'ai');
  const canMutate = hasPermission(roles, 'policy_mutate');
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [semantic, setSemantic] = useState<SemanticOutcome[]>([]);
  const [semanticHint, setSemanticHint] = useState<string | null>(null);
  const [aiInitialized, setAiInitialized] = useState(false);
  const [engineState, setEngineState] = useState<Record<string, unknown> | null>(null);
  const [baselines, setBaselines] = useState<unknown[]>([]);
  const [threats, setThreats] = useState<ThreatIntelStatus | null>(null);
  const [threatPollBusy, setThreatPollBusy] = useState(false);
  const [reportSnippet, setReportSnippet] = useState('');
  const [reportStructured, setReportStructured] = useState<Record<string, unknown> | null>(null);
  const [activeLearning, setActiveLearning] = useState<Record<string, unknown> | null>(null);
  const [abuseScores, setAbuseScores] = useState<Array<Record<string, unknown>>>([]);
  const [investigateId, setInvestigateId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [sug, semResp, st, base, thr, rep, al, abuse] = await Promise.all([
      fetchAiSuggestions(),
      fetchSemanticOutcomes(),
      fetchAiState(),
      fetchAiBaselines(),
      fetchAiThreats(),
      fetchAiReport(),
      fetchActiveLearningReport(),
      fetchAgentAbuseScores(7),
    ]);
    setSuggestions(sug);
    setSemantic(semResp.records);
    setSemanticHint(semResp.meta?.hint ?? null);
    setAiInitialized(!!st?.initialized);
    setEngineState(st?.state ?? null);
    setBaselines(base);
    setThreats(thr);
    const snippet = rep?.report ? JSON.stringify(rep.report, null, 2).slice(0, 1500) : '';
    setReportSnippet(snippet);
    setReportStructured((rep?.report as Record<string, unknown>) ?? null);
    setActiveLearning(al);
    setAbuseScores((abuse?.scores as Array<Record<string, unknown>>) ?? []);
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

  const onQuarantineThreat = async (id: string) => {
    if (!canMutate) {
      onAction?.('Requires operator role');
      return;
    }
    if (!window.confirm(`Quarantine ${id}? This will auto-apply a blocking policy rule immediately.`)) return;
    const res = await quarantineThreatIntel(id);
    if (res.ok) {
      onAction?.(
        `Quarantined ${id}${res.appliedRuleName ? ` · applied ${res.appliedRuleName}` : ''}. See Security → Quarantined.`,
      );
      await Promise.all([refresh(), fetchQuarantinedThreats(30)]);
    } else {
      onAction?.(res.error || 'Quarantine failed');
    }
  };

  const onRemoveThreat = async (id: string) => {
    if (!canMutate) {
      onAction?.('Requires operator role');
      return;
    }
    if (!window.confirm(`Remove ${id} from active threat catalog?`)) return;
    const res = await dismissThreatIntel(id);
    if (res.ok) {
      onAction?.(`Removed ${id} from active threat catalog`);
      await refresh();
    } else {
      onAction?.(res.error || 'Remove failed');
    }
  };

  const confidenceChart = suggestions.map((s, i) => ({
    name: (s.ruleName || s.id || `s${i}`).slice(0, 16),
    confidence: Math.round((s.confidence ?? 0) * 100),
  }));

  const execSummary =
    typeof reportStructured?.executiveSummary === 'string'
      ? reportStructured.executiveSummary
      : null;
  const recommendations = Array.isArray(reportStructured?.recommendations)
    ? (reportStructured.recommendations as string[])
    : [];
  const crossInsights = (
    reportStructured?.patterns as { crossLayerInsights?: Array<{ description: string; severity: string }> }
  )?.crossLayerInsights;

  return (
    <div className="ai-learning-panel">
      <InsightsNarrativeRail scope="ai" refreshKey={refreshTick} />

      <DashboardSection
        title="AI copilot & learning"
        subtitle="Policy suggestions, semantic labels, and threat intel — closes the attack-learning loop"
      >

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
        <div className="kpi-row">
          <KpiCard
            label="True positive rate"
            value={String(engineState.truePositiveRate ?? '—')}
            explanation="Share of operator-labeled semantic outcomes confirmed as attacks."
          />
          <KpiCard
            label="False positive rate"
            value={String(engineState.falsePositiveRate ?? '—')}
            variant={Number(engineState.falsePositiveRate) > 0.2 ? 'warn' : 'default'}
          />
          <KpiCard label="Threat intel IDs" value={threats?.threats ?? 0} sub={`Updated ${formatTs(threats?.updated)}`} />
          <KpiCard label="Baselines" value={baselines.length} />
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
              <th>Actions</th>
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
                <td>
                  {canMutate ? (
                    <span className="btn-row inline">
                      <button
                        type="button"
                        className="secondary btn-sm"
                        onClick={() => void onQuarantineThreat(entry.id)}
                      >
                        Quarantine
                      </button>
                      <button
                        type="button"
                        className="secondary btn-sm"
                        onClick={() => void onRemoveThreat(entry.id)}
                      >
                        Remove
                      </button>
                    </span>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Pending suggestions</h3>
      {suggestions.length > 0 ? (
        <ChartCard title="Suggestion confidence" subtitle="Higher confidence → prioritize review" empty={false} height={200}>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={confidenceChart.slice(0, 12)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <Bar dataKey="confidence" fill={CHART_COLORS[0]} name="Confidence %" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      ) : null}
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

      {Array.isArray(activeLearning?.reviewQueue) && activeLearning.reviewQueue.length > 0 ? (
        <>
          <h3>Review next (uncertainty-ranked)</h3>
          <table className="data-table compact">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Uncertainty</th>
                <th>Reasons</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(activeLearning.reviewQueue as Array<Record<string, unknown>>).slice(0, 5).map((r) => (
                <tr key={String(r.id)}>
                  <td>{String(r.toolName || '—')}</td>
                  <td>{String(r.uncertaintyScore ?? '—')}</td>
                  <td>{((r.uncertaintyReasons as string[]) || []).join('; ')}</td>
                  <td>
                    <button type="button" className="secondary btn-sm" onClick={() => setInvestigateId(String(r.id))}>
                      Investigate
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {activeLearning.thresholds ? (
            <p className="hint">
              Threshold suggestion: min confidence{' '}
              {String((activeLearning.thresholds as Record<string, unknown>).recommendedMinConfidence ?? '—')}
              {' — '}
              {String((activeLearning.thresholds as Record<string, unknown>).rationale ?? '')}
            </p>
          ) : null}
        </>
      ) : null}

      <p className="hint">
        Swarm tribunal, compliance briefing, and LoRA pipeline → open the <strong>Enterprise AI</strong> tab.
      </p>

      {abuseScores.length > 0 ? (
        <>
          <h3>Agent abuse scores</h3>
          <table className="data-table compact">
            <thead>
              <tr>
                <th>Server</th>
                <th>Score</th>
                <th>Risk</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {abuseScores.slice(0, 8).map((s) => (
                <tr key={String(s.sessionKey)}>
                  <td>{String(s.serverName || '—')}</td>
                  <td>{String(s.score ?? '—')}</td>
                  <td>{String(s.riskLevel ?? '—')}</td>
                  <td className="cell-truncate">{String(s.summary || '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <h3>Semantic audit outcomes</h3>
      {semantic.length === 0 ? (
        <p className="muted">
          {semanticHint ||
            'No semantic audit records yet. Set GUARDIAN_LLM_ENABLED=true and GUARDIAN_SEMANTIC_ASYNC=true on the proxy, route MCP traffic through Guardian, then refresh.'}
        </p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Rule</th>
              <th>Confidence</th>
              <th>Label</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {semantic.slice(0, 30).map((r) => (
              <tr key={r.id}>
                <td>{r.toolName || '—'}</td>
                <td>{r.ruleName || '—'}</td>
                <td>
                  {r.confidence != null ? `${(r.confidence * 100).toFixed(0)}%` : '—'}
                </td>
                <td>{r.label || '—'}</td>
                <td>
                  {canAi ? (
                    <span className="btn-row inline">
                      <button type="button" className="secondary" onClick={() => setInvestigateId(r.id)}>
                        Investigate
                      </button>
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

      {(execSummary || recommendations.length > 0 || crossInsights?.length) ? (
        <>
          <h3>AI learning report</h3>
          {execSummary ? <p className="insight-callout-list">{execSummary}</p> : null}
          {recommendations.length > 0 ? (
            <ul className="insight-callout-list">
              {recommendations.slice(0, 6).map((r) => (
                <li key={r.slice(0, 40)}>{r}</li>
              ))}
            </ul>
          ) : null}
          {crossInsights?.length ? (
            <ul className="insight-callout-list">
              {crossInsights.slice(0, 5).map((i) => (
                <li key={i.description.slice(0, 40)}>
                  [{i.severity}] {i.description}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : reportSnippet ? (
        <>
          <h3>AI report (raw excerpt)</h3>
          <pre className="code-block">{reportSnippet}</pre>
        </>
      ) : null}
      </DashboardSection>
      {investigateId ? (
        <IncidentInvestigatorDrawer
          triggerId={investigateId}
          onClose={() => setInvestigateId(null)}
          onOpenThreatLab={(ctx) => {
            setInvestigateId(null);
            onOpenThreatLab?.(ctx);
          }}
        />
      ) : null}
    </div>
  );
}
