'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  downloadSwarmReport,
  fetchPlainEnglishReport,
  fetchSwarmJobLog,
  fetchSwarmLatest,
  fetchSwarmStatus,
  fetchToolIntegrityReport,
  fetchTrafficSummary,
  runSecuritySwarm,
  type PlainEnglishReport,
  type SwarmJobStatus,
  type SwarmLatest,
  type TrafficSummary,
} from '@/lib/mastyf-ai-api';
import { hasPermission } from '@/lib/dashboard-roles';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { KpiCard } from '../ui/KpiCard';
import { EmptyState } from '../ui/EmptyState';
import { SeverityBadge } from '../ui/Badge';

type Props = {
  roles?: string[];
  refreshKey: number;
  onAction?: (msg: string) => void;
};

const POLL_MS = 2000;

function gateBadge(ok: unknown) {
  return <Badge variant={ok ? 'success' : 'danger'}>{ok ? 'PASS' : 'FAIL'}</Badge>;
}

function PlainEnglishSections({ report }: { report: PlainEnglishReport }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {report.headline ? (
        <div>
          <Badge variant={report.verdict === 'PASS' ? 'success' : report.verdict === 'FAIL' ? 'danger' : 'warning'}>
            {report.verdict || 'REVIEW'}
          </Badge>
          <p className="font-medium text-sm" style={{ marginTop: 'var(--space-2)' }}>{report.headline}</p>
        </div>
      ) : null}
      {(report.sections ?? []).map(section => (
        <div key={section.id}>
          <h4 className="text-sm font-semibold" style={{ marginBottom: 'var(--space-2)' }}>{section.title}</h4>
          {section.bullets?.length ? (
            <ul className="text-sm text-muted" style={{ margin: 0, paddingLeft: 'var(--space-4)' }}>
              {section.bullets.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          ) : null}
          {section.markdown ? (
            <pre className="text-xs text-muted" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{section.markdown.slice(0, 1200)}</pre>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function SocSwarmAnalysisView({ roles = [], refreshKey, onAction }: Props) {
  const canRun = hasPermission(roles, 'policy_test');
  const [jobStatus, setJobStatus] = useState<SwarmJobStatus | null>(null);
  const [plainReport, setPlainReport] = useState<PlainEnglishReport | null>(null);
  const [traffic, setTraffic] = useState<TrafficSummary | null>(null);
  const [toolIntegrity, setToolIntegrity] = useState<Record<string, unknown> | null>(null);
  const [jobLog, setJobLog] = useState('');
  const [latest, setLatest] = useState<SwarmLatest | null>(null);
  const [findings, setFindings] = useState<Array<{ severity: string; source: string; summary: string }>>([]);
  const [failedSteps, setFailedSteps] = useState<Array<{ label: string; elapsedSec?: number }>>([]);
  const [corpusStats, setCorpusStats] = useState<{ fn?: number; fp?: number; attackBlockRate?: number } | null>(null);
  const [parityStats, setParityStats] = useState<{ agreementRate?: number; corpusMismatches?: number } | null>(null);
  const [gates, setGates] = useState<Record<string, unknown> | null>(null);
  const [overall, setOverall] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [status, latest, pr, tr, tw, jl] = await Promise.all([
      fetchSwarmStatus(),
      fetchSwarmLatest(),
      fetchPlainEnglishReport(),
      fetchTrafficSummary(),
      fetchToolIntegrityReport(),
      fetchSwarmJobLog(),
    ]);
    setJobStatus(status);
    setPlainReport(pr);
    setTraffic(tr);
    setToolIntegrity(tw);
    setJobLog(jl?.log ?? '');
    setLatest(latest);
    setFindings(latest?.findings ?? []);
    setFailedSteps((latest?.steps ?? []).filter(s => s.ok === false).map(s => ({ label: s.label, elapsedSec: s.elapsedSec })));
    setCorpusStats(latest?.corpus ? { fn: latest.corpus.fn, fp: latest.corpus.fp, attackBlockRate: latest.corpus.attackBlockRate } : null);
    setParityStats(latest?.parity ? { agreementRate: latest.parity.agreementRate, corpusMismatches: latest.parity.corpusMismatches } : null);
    setGates((latest?.gates as Record<string, unknown>) ?? null);
    setOverall(latest?.overall ?? null);
    setLoading(false);
    return status;
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const refreshStatus = useCallback(async () => {
    const [st, jl] = await Promise.all([fetchSwarmStatus(), fetchSwarmJobLog()]);
    if (st) setJobStatus(st);
    if (jl?.log != null) setJobLog(jl.log);
    return st;
  }, []);

  useEffect(() => {
    const running = jobStatus?.state === 'running';
    if (!running) {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = window.setInterval(() => void refreshStatus(), POLL_MS);
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [jobStatus?.state, refreshStatus]);

  const onRun = async (full: boolean) => {
    if (!canRun) { onAction?.('Requires policy_test role'); return; }
    if (full && !window.confirm('Full nightly analysis can take 45–90 minutes. Continue?')) return;
    setBusy(true);
    const res = await runSecuritySwarm({ full });
    if (!res?.ok) {
      onAction?.(res?.error || 'Failed to start analysis');
    } else {
      onAction?.('Analysis started — progress updates below');
      void refreshStatus();
    }
    setBusy(false);
  };

  const jobState = jobStatus?.state ?? 'idle';
  const jobAccent = jobState === 'running' ? 'warning' : jobState === 'done' ? 'success' : jobState === 'failed' ? 'danger' : 'neutral';
  const running = jobState === 'running';
  const done = jobState === 'done';

  return (
    <>
      <div className="kpi-grid">
        <KpiCard label="Swarm Job" value={loading ? '…' : jobState} accent={jobAccent} />
        <KpiCard label="Findings" value={findings.length} accent={findings.length > 0 ? 'warning' : 'success'} />
        <KpiCard label="Overall Gate" value={overall == null ? '—' : overall ? 'PASS' : 'FAIL'} accent={overall ? 'success' : overall === false ? 'danger' : 'neutral'} />
        <KpiCard
          label="Progress"
          value={running ? `${jobStatus?.progressPct ?? 0}%` : done ? 'Complete' : '—'}
          secondary={jobStatus?.phaseLabel ?? undefined}
          accent="info"
        />
      </div>

      <div className="grid grid-12" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="col-span-8">
          <Card title="Run Security Swarm" subtitle="Autonomous red-team replay — feeds Threat Detection and Threat Intel">
            {!canRun ? (
              <p className="text-sm text-muted">Sign in with policy_test role to start analysis.</p>
            ) : (
              <div className="flex gap-2 flex-wrap">
                <Button variant="primary" disabled={running || busy} onClick={() => void onRun(false)}>
                  {running ? 'Running…' : 'Run Analysis'}
                </Button>
                <Button variant="secondary" disabled={running || busy} onClick={() => void onRun(true)}>
                  Full Nightly (~90 min)
                </Button>
                {done ? (
                  <Button variant="ghost" onClick={() => void downloadSwarmReport()}>Download Report</Button>
                ) : null}
                <Button variant="ghost" onClick={() => void load()} disabled={loading}>Refresh</Button>
              </div>
            )}
            {running && jobStatus?.phaseLabel ? (
              <p className="text-sm text-muted" style={{ marginTop: 'var(--space-3)' }}>
                {jobStatus.phaseLabel} ({jobStatus.progressPct}%)
              </p>
            ) : null}
            {jobStatus?.state === 'failed' && jobStatus.error ? (
              <div className="banner banner-warning" style={{ marginTop: 'var(--space-3)' }}>
                <div className="banner-content">{jobStatus.error}</div>
              </div>
            ) : null}
          </Card>
        </div>
        <div className="col-span-4">
          <Card title="Regression Gates">
            {gates ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="flex items-center justify-between text-sm"><span>Overall</span>{gateBadge(overall)}</div>
                <div className="flex items-center justify-between text-sm"><span>Corpus</span>{gateBadge(gates.corpus)}</div>
                <div className="flex items-center justify-between text-sm"><span>Parity</span>{gateBadge(gates.parity)}</div>
                <div className="flex items-center justify-between text-sm"><span>Steps</span>{gateBadge(gates.steps)}</div>
                <div className="flex items-center justify-between text-sm"><span>Scout</span>{gateBadge(gates.scout)}</div>
              </div>
            ) : (
              <p className="text-sm text-muted">Run analysis to evaluate gates</p>
            )}
          </Card>
        </div>
      </div>

      {(failedSteps.length > 0 || corpusStats || parityStats) ? (
        <div className="grid grid-12" style={{ marginBottom: 'var(--space-5)' }}>
          {failedSteps.length > 0 ? (
            <div className="col-span-6">
              <Card title="Failed Steps" subtitle="Regression pipeline steps that did not pass">
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Step</th>
                        <th>Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {failedSteps.map(s => (
                        <tr key={s.label}>
                          <td className="text-sm"><Badge variant="danger">{s.label}</Badge></td>
                          <td className="text-xs">{s.elapsedSec != null ? `${s.elapsedSec}s` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted" style={{ marginTop: 'var(--space-3)' }}>
                  See job log below or <code>reports/tenants/default/security-swarm/analysis.txt</code> for details.
                </p>
              </Card>
            </div>
          ) : null}
          <div className={failedSteps.length > 0 ? 'col-span-6' : 'col-span-12'}>
            <Card title="Gate Metrics" subtitle="Why Corpus / Parity gates failed">
              <div className="flex flex-wrap gap-4 text-sm">
                {corpusStats ? (
                  <>
                    <div><span className="text-muted">Corpus FN</span> <strong>{corpusStats.fn ?? '—'}</strong></div>
                    <div><span className="text-muted">Corpus FP</span> <strong>{corpusStats.fp ?? '—'}</strong></div>
                    <div><span className="text-muted">Block rate</span> <strong>{corpusStats.attackBlockRate != null ? `${(corpusStats.attackBlockRate * 100).toFixed(1)}%` : '—'}</strong></div>
                  </>
                ) : null}
                {parityStats ? (
                  <>
                    <div><span className="text-muted">Parity</span> <strong>{parityStats.agreementRate != null ? `${(parityStats.agreementRate * 100).toFixed(1)}%` : '—'}</strong></div>
                    <div><span className="text-muted">Mismatches</span> <strong>{parityStats.corpusMismatches ?? '—'}</strong></div>
                  </>
                ) : null}
              </div>
              {corpusStats && (corpusStats.fn ?? 0) > 0 ? (
                <p className="text-sm text-muted" style={{ marginTop: 'var(--space-3)' }}>
                  {corpusStats.fn} attack fixture(s) were not blocked (need 0 false negatives). Common gaps: dangerous-js, context-injection categories.
                </p>
              ) : null}
            </Card>
          </div>
        </div>
      ) : null}

      <Card title="Plain English Report" subtitle="Executive summary of the latest swarm run">
        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : plainReport?.headline || plainReport?.sections?.length ? (
          <PlainEnglishSections report={plainReport} />
        ) : (
          <EmptyState title="No report" message="Run analysis to generate a plain-English security report" />
        )}
      </Card>

      {traffic?.hasData && (traffic.servers?.length ?? 0) > 0 ? (
        <div className="section">
          <Card title="Traffic Summary" subtitle={`Last ${traffic.windowDays ?? 7} days`}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Server</th>
                    <th>Calls</th>
                    <th>Blocked</th>
                    <th>Top Tool</th>
                  </tr>
                </thead>
                <tbody>
                  {(traffic.servers || []).map(s => (
                    <tr key={s.serverName}>
                      <td>{s.serverName}</td>
                      <td>{s.calls}</td>
                      <td>{s.blocked}</td>
                      <td className="text-sm">{s.topTools?.[0]?.tool ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      {toolIntegrity?.hasData ? (
        <div className="section">
          <Card title="Tool Integrity" subtitle="Manifest and schema drift from ToolWatch">
            <p className="text-sm">
              {String(toolIntegrity.summary || 'Tool integrity scan completed')}
            </p>
          </Card>
        </div>
      ) : null}

      <div className="section">
        <Card title="Swarm Findings" subtitle="Actionable items from the latest run">
          {findings.length === 0 ? (
            <EmptyState title="No findings" message="A clean swarm run produces no critical findings" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Severity</th>
                    <th>Source</th>
                    <th>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {findings.map((f, i) => (
                    <tr key={`${f.source}-${i}`} className={f.severity === 'CRITICAL' ? 'row-critical' : f.severity === 'HIGH' ? 'row-warning' : ''}>
                      <td><SeverityBadge severity={f.severity} /></td>
                      <td className="text-sm">{f.source}</td>
                      <td className="text-sm">{f.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {jobLog ? (
        <details className="section">
          <summary className="text-sm font-medium" style={{ cursor: 'pointer', marginBottom: 'var(--space-3)' }}>Job log (tail)</summary>
          <pre className="text-xs text-muted" style={{ whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto' }}>
            {jobLog.split('\n').slice(-40).join('\n')}
          </pre>
        </details>
      ) : null}
    </>
  );
}
