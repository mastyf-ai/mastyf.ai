'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  acceptSuggestion,
  fetchActiveLearningReport,
  fetchAgentAbuseScores,
  fetchAiState,
  fetchAiSuggestions,
  fetchSemanticOutcomes,
  labelSemanticOutcome,
  rejectSuggestion,
  rollbackAiLearning,
  type AiSuggestion,
  type SemanticOutcome,
} from '@/lib/mastyf-ai-api';
import { useTribunalBatch } from '@/lib/use-tribunal-batch';
import { TRIBUNAL_BATCH_LIMIT } from '@/lib/tribunal-config';
import { hasPermission } from '@/lib/dashboard-roles';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { KpiCard } from '../ui/KpiCard';
import { EmptyState } from '../ui/EmptyState';
import { TribunalSummaryCard } from '../TribunalSummaryCard';
import { IncidentInvestigatorDrawer } from '../IncidentInvestigatorDrawer';
import { useDashboardWindow } from '../dashboard/DashboardWindowContext';

type Props = {
  roles?: string[];
  refreshKey: number;
  aiRefreshTick?: number;
  onAction?: (msg: string) => void;
  onOpenThreatLab?: (ctx: import('../IncidentInvestigatorDrawer').ThreatLabContext) => void;
};

export function SocAiLearningView({ roles = [], refreshKey, aiRefreshTick = 0, onAction, onOpenThreatLab }: Props) {
  const canAi = hasPermission(roles, 'ai');
  const canMutate = hasPermission(roles, 'policy_mutate');
  const { windowParam } = useDashboardWindow();
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [semantic, setSemantic] = useState<SemanticOutcome[]>([]);
  const [semanticHint, setSemanticHint] = useState<string | null>(null);
  const [semanticAsyncOn, setSemanticAsyncOn] = useState(false);
  const [engineState, setEngineState] = useState<Record<string, unknown> | null>(null);
  const [aiInitialized, setAiInitialized] = useState(false);
  const [activeLearning, setActiveLearning] = useState<Record<string, unknown> | null>(null);
  const [abuseScores, setAbuseScores] = useState<Array<Record<string, unknown>>>([]);
  const [investigateId, setInvestigateId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const {
    job: tribunalJob,
    report: tribunal,
    queue: tribunalQueue,
    running: tribunalRunning,
    refresh: refreshTribunal,
    start: startTribunal,
  } = useTribunalBatch(TRIBUNAL_BATCH_LIMIT, refreshKey);
  const lastTribunalNoticeRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [semResp, st] = await Promise.all([
      fetchSemanticOutcomes(),
      fetchAiState(),
    ]);
    setSemantic(semResp.records);
    setSemanticHint(semResp.meta?.hint ?? null);
    setSemanticAsyncOn(!!semResp.meta?.asyncEnabled);
    setAiInitialized(!!st?.initialized);
    setEngineState(st?.state ?? null);

    const [sug, al, abuse] = await Promise.all([
      fetchAiSuggestions(),
      fetchActiveLearningReport(),
      fetchAgentAbuseScores(windowParam),
    ]);
    setSuggestions(sug);
    setActiveLearning(al);
    setAbuseScores((abuse?.scores as Array<Record<string, unknown>>) ?? []);
    await refreshTribunal();
    setLoading(false);
  }, [refreshTribunal, windowParam]);

  useEffect(() => { void load(); }, [load, refreshKey, aiRefreshTick]);

  const onRunTribunal = async () => {
    if (!canAi || tribunalRunning) return;
    const res = await startTribunal();
    if (res.ok) {
      onAction?.(
        res.jobId
          ? `Tribunal batch started — job ${res.jobId.slice(0, 8)}…`
          : 'Tribunal batch started',
      );
    } else {
      onAction?.(res.error || 'Failed to start tribunal batch');
    }
  };

  useEffect(() => {
    if (tribunalJob?.state !== 'done' && tribunalJob?.state !== 'failed') return;
    if (!tribunalJob.finishedAt) return;
    if (lastTribunalNoticeRef.current === tribunalJob.finishedAt) return;
    lastTribunalNoticeRef.current = tribunalJob.finishedAt;
    const n = tribunalJob.debatedCount ?? tribunal?.debatedCount ?? 0;
    if (tribunalJob.state === 'failed') {
      onAction?.(tribunalJob.error || 'Tribunal batch failed');
      return;
    }
    onAction?.(
      n > 0
        ? `Tribunal complete: ${n} debate(s) · ${tribunalJob.remainingEligible ?? 0} remaining`
        : 'Tribunal complete — no uncertain flags in queue',
    );
  }, [tribunalJob?.state, tribunalJob?.finishedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const onAccept = async (s: AiSuggestion) => {
    if (!canMutate) { onAction?.('Requires operator role'); return; }
    setBusy(`accept:${s.id}`);
    const res = await acceptSuggestion(s);
    onAction?.(res.ok ? `Accepted ${s.ruleName || s.id}` : res.error || 'Accept failed');
    if (res.ok) await load();
    setBusy('');
  };

  const onReject = async (s: AiSuggestion) => {
    if (!canMutate) { onAction?.('Requires operator role'); return; }
    setBusy(`reject:${s.id}`);
    const res = await rejectSuggestion(s);
    onAction?.(res.ok ? `Rejected ${s.ruleName || s.id}` : res.error || 'Reject failed');
    if (res.ok) await load();
    setBusy('');
  };

  const onLabel = async (id: string, label: 'true_positive' | 'false_positive' | 'ignored') => {
    if (!canAi) { onAction?.('Requires ai role'); return; }
    setBusy(`label:${id}`);
    const res = await labelSemanticOutcome({ semanticAuditId: id, label });
    onAction?.(res.ok ? `Labeled ${id} as ${label}` : res.error || 'Label failed');
    if (res.ok) await load();
    setBusy('');
  };

  const onRollback = async () => {
    if (!canAi) { onAction?.('Requires ai role'); return; }
    if (!window.confirm('Rollback AI learning snapshots?')) return;
    const res = await rollbackAiLearning();
    onAction?.(res.ok ? 'AI learning rolled back' : res.error || 'Rollback failed');
    if (res.ok) await load();
  };

  const reviewQueue = (activeLearning?.reviewQueue as Array<Record<string, unknown>>) || [];
  const tpRate = engineState?.truePositiveRate;
  const fpRate = engineState?.falsePositiveRate;

  return (
    <>
      <div className="kpi-grid">
        <KpiCard
          label="True Positive Rate"
          value={aiInitialized ? String(tpRate ?? 0) : '—'}
          accent="success"
        />
        <KpiCard
          label="False Positive Rate"
          value={aiInitialized ? String(fpRate ?? 0) : '—'}
          accent={Number(fpRate) > 0.2 ? 'warning' : 'neutral'}
        />
        <KpiCard label="Pending Suggestions" value={suggestions.length} accent={suggestions.length > 0 ? 'warning' : 'success'} />
        <KpiCard label="Semantic Audits" value={semantic.length} accent="info" />
      </div>

      <div className="grid grid-12" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="col-span-8">
          <Card
            title="Policy Suggestions"
            subtitle="AI-generated rule candidates — accept to write YAML, reject to dismiss"
            actions={
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>Refresh</Button>
                {canAi ? (
                  <Button variant="ghost" size="sm" onClick={() => void onRollback()}>Rollback</Button>
                ) : null}
              </div>
            }
          >
            {!aiInitialized ? (
              <p className="text-sm text-muted">
                AI engine starting — restart the proxy with{' '}
                <code className="text-xs">./scripts/start-dashboard-proxy.sh</code> to run learning warmup
                from corpus fixtures, or route live MCP traffic through the proxy.
              </p>
            ) : suggestions.length === 0 ? (
              <EmptyState title="No suggestions" message="Suggestions appear after policy blocks and semantic audits" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Rule</th>
                      <th>Source</th>
                      <th>Confidence</th>
                      <th>Reason</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {suggestions.map(s => (
                      <tr key={String(s.id || s.ruleName)}>
                        <td><code className="text-xs">{s.ruleName || s.id}</code></td>
                        <td className="text-sm">{s.source}</td>
                        <td><Badge variant={(s.confidence ?? 0) >= 0.7 ? 'danger' : 'warning'}>{((s.confidence ?? 0) * 100).toFixed(0)}%</Badge></td>
                        <td className="text-sm">{s.reason?.slice(0, 80)}{(s.reason?.length ?? 0) > 80 ? '…' : ''}</td>
                        <td>
                          {canMutate ? (
                            <div className="flex gap-1">
                              <Button size="sm" variant="primary" disabled={!!busy} onClick={() => void onAccept(s)}>Accept</Button>
                              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void onReject(s)}>Reject</Button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
        <div className="col-span-4">
          <TribunalSummaryCard
            tribunal={tribunal}
            job={tribunalJob}
            queue={tribunalQueue}
            tribunalLoading={tribunalRunning}
            onRunTribunal={canAi ? () => void onRunTribunal() : undefined}
            onInvestigateRecord={canAi ? (id) => setInvestigateId(id) : undefined}
          />
        </div>
      </div>

      <Card
        title="Semantic Audit Outcomes"
        subtitle="Label outcomes to train the detection model — true positive, false positive, or ignored"
      >
        {semantic.length === 0 ? (
          <EmptyState
            title="No semantic records"
            message={
              semanticHint
              || (semanticAsyncOn
                ? 'Learning warmup seeds corpus samples on proxy start — restart the proxy, or send MCP tool calls through Mastyf AI.'
                : 'Set MASTYF_AI_SEMANTIC_ASYNC=true on the proxy (enabled by default with MASTYF_AI_LLM_ENABLED=true).')
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Rule</th>
                  <th>Confidence</th>
                  <th>Label</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {semantic.slice(0, 25).map(r => (
                  <tr key={r.id}>
                    <td className="text-sm">{r.toolName || '—'}</td>
                    <td className="text-xs">{r.ruleName || '—'}</td>
                    <td>{r.confidence != null ? `${(r.confidence * 100).toFixed(0)}%` : '—'}</td>
                    <td><Badge variant={r.label === 'true_positive' ? 'danger' : r.label === 'false_positive' ? 'success' : 'neutral'}>{r.label || 'unlabeled'}</Badge></td>
                    <td>
                      <div className="flex gap-1 flex-wrap">
                        {canAi ? (
                          <>
                            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void onLabel(r.id, 'true_positive')}>TP</Button>
                            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void onLabel(r.id, 'false_positive')}>FP</Button>
                            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setInvestigateId(r.id)}>Investigate</Button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {reviewQueue.length > 0 ? (
        <div className="section">
          <Card title="Active Learning Queue" subtitle="Uncertainty-ranked items for analyst review">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Tool</th>
                    <th>Uncertainty</th>
                    <th>Reasons</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {reviewQueue.slice(0, 8).map(r => (
                    <tr key={String(r.id)}>
                      <td className="text-sm">{String(r.toolName || '—')}</td>
                      <td>{String(r.uncertaintyScore ?? '—')}</td>
                      <td className="text-xs">{((r.uncertaintyReasons as string[]) || []).join('; ')}</td>
                      <td>
                        <Button size="sm" variant="ghost" onClick={() => setInvestigateId(String(r.id))}>Investigate</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      {abuseScores.length > 0 ? (
        <div className="section">
          <Card title="Agent Abuse Scores" subtitle="Session-level risk scoring from MCP call patterns">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Server</th>
                    <th>Score</th>
                    <th>Risk</th>
                    <th>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {abuseScores.slice(0, 10).map(s => (
                    <tr key={String(s.sessionKey)}>
                      <td className="text-sm">{String(s.serverName || '—')}</td>
                      <td>{String(s.score ?? '—')}</td>
                      <td><Badge variant={String(s.riskLevel) === 'high' ? 'danger' : 'warning'}>{String(s.riskLevel ?? '—')}</Badge></td>
                      <td className="text-sm truncate">{String(s.summary || '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      {investigateId ? (
        <IncidentInvestigatorDrawer
          triggerId={investigateId}
          onClose={() => setInvestigateId(null)}
          onOpenThreatLab={onOpenThreatLab}
        />
      ) : null}
    </>
  );
}