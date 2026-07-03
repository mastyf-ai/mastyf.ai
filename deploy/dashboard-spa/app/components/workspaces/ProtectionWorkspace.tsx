'use client';

/** @deprecated Unmounted — use SecurityOperationsCenter + PlatformIntegrationsPanel. See `_archive/README.md`. */

import { useCallback, useEffect, useState } from 'react';
import {
  fetchAutopilotStatus,
  fetchContinuousAssuranceReport,
  fetchPendingSuggestions,
  fetchSimilarEnvironmentBenchmarks,
  fetchLatestDigest,
  generateDigestNow,
  runSecuritySwarm,
  type AutopilotStatus,
  type AggregateMetrics,
  type AuditResponse,
  type ContinuousAssuranceReport,
  type SimilarEnvironmentBenchmarksResponse,
} from '@/lib/mastyf-ai-api';
import { HealthReportPanel } from '../reports/HealthReportPanel';
import { ExecutiveOverviewPanel } from '../dashboard/ExecutiveOverviewPanel';
import { FullAnalysisDrawer } from '../FullAnalysisDrawer';
import { RoadmapComplianceStrip } from '../agentic/RoadmapComplianceStrip';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { SkeletonText } from '../ui/Skeleton';

type Props = {
  refreshKey: number;
  metrics: AggregateMetrics | null | undefined;
  audit: AuditResponse | null;
  proxyOnline: boolean | null;
  onReportLoading?: (loading: boolean) => void;
  onAction?: (msg: string) => void;
  onNavigateAdvanced?: (workspace: string, view?: string) => void;
  showAdvancedNav?: boolean;
};

export function ProtectionWorkspace({
  refreshKey,
  metrics,
  audit,
  proxyOnline,
  onReportLoading,
  onAction,
  onNavigateAdvanced,
  showAdvancedNav = true,
}: Props) {
  const [status, setStatus] = useState<AutopilotStatus | null>(null);
  const [digestPreview, setDigestPreview] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const [busy, setBusy] = useState('');
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [assurance, setAssurance] = useState<ContinuousAssuranceReport | null>(null);
  const [benchmarks, setBenchmarks] = useState<SimilarEnvironmentBenchmarksResponse | null>(null);

  const load = useCallback(async () => {
    const [st, dig, pending, assuranceReport, benchmarkData] = await Promise.all([
      fetchAutopilotStatus(),
      fetchLatestDigest(),
      fetchPendingSuggestions(),
      fetchContinuousAssuranceReport(),
      fetchSimilarEnvironmentBenchmarks(),
    ]);
    setStatus(st);
    setDigestPreview(dig.healthMarkdown?.slice(0, 400) || '');
    setPendingCount(pending.count);
    setAssurance(assuranceReport);
    setBenchmarks(benchmarkData);
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const onGenerateDigest = async () => {
    setBusy('digest');
    try {
      const res = await generateDigestNow();
      if (res.ok) {
        onAction?.('Digest generated');
        await load();
      } else {
        onAction?.(res.error || 'Digest failed');
      }
    } finally {
      setBusy('');
    }
  };

  const onRunAnalysis = async () => {
    setBusy('swarm');
    try {
      const res = await runSecuritySwarm({ full: false });
      onAction?.(
        res?.ok ? 'Security analysis started' : res?.error || 'Failed to start analysis',
      );
    } finally {
      setBusy('');
    }
  };

  const semanticFlags = audit?.flagged ?? audit?.semanticAudit?.flagged ?? 0;
  const topBenchmarks = (benchmarks?.benchmarks ?? []).slice(0, 5);

  return (
    <>
      <section className="briefing-hero">
        <h2>mastyf.ai Autopilot — your MCP protection</h2>
        <p className="briefing-hero-lead">
          Realtime blocking, autonomous threat learning, and scheduled digests.
        </p>
        <p className="hint">
          You are in <strong>Protection</strong>. Primary goal: keep protection healthy. Next step:
          run security analysis, then review AI suggestions.
        </p>
      </section>

      <RoadmapComplianceStrip refreshKey={refreshKey} />

      <Card title="Protection status" subtitle="Live Autopilot services">
        {status ? (
          <ul className="insight-callout-list">
            <li>
              Autopilot: <strong>{status.autopilotEnabled ? 'on' : 'off'}</strong> · Scheduler:{' '}
              <strong>{status.scheduler?.running ? 'running' : 'stopped'}</strong>
            </li>
            <li>
              Pending policy suggestions: <strong>{pendingCount}</strong> · Threat research queue:{' '}
              <strong>{status.learning?.threatResearchQueue?.queued ?? 0}</strong>
            </li>
            <li>
              LLM: <strong>{status.llm?.ok ? 'ready' : 'needs setup'}</strong>
              {status.lastDigest?.generatedAt
                ? ` · Last digest: ${new Date(status.lastDigest.generatedAt).toLocaleString()}`
                : ''}
            </li>
            {(status.messages ?? []).map((m) => (
              <li key={m.slice(0, 32)} className="hint">
                {m}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Autopilot status unavailable" message="Ensure proxy is running on port 4000." />
        )}
        <div className="btn-row">
          <strong style={{ marginRight: 8 }}>Run</strong>
          <Button variant="secondary" size="sm" loading={busy === 'swarm'} onClick={() => void onRunAnalysis()}>
            Start security analysis
          </Button>
          <Button variant="secondary" size="sm" loading={busy === 'digest'} onClick={() => void onGenerateDigest()}>
            Generate health digest
          </Button>
        </div>
        <div className="btn-row">
          <strong style={{ marginRight: 8 }}>Review</strong>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onNavigateAdvanced?.('security', 'ai-copilot')}
          >
            Review AI policy suggestions
          </Button>
          <Button variant="primary" size="sm" disabled={!!busy} onClick={() => setAnalysisOpen(true)}>
            Open full analysis report
          </Button>
          {showAdvancedNav ? (
            <Button variant="secondary" size="sm" onClick={() => onNavigateAdvanced?.('threats', 'overview')}>
              Open threat discovery
            </Button>
          ) : null}
        </div>
        {digestPreview ? (
          <pre className="code-block" style={{ marginTop: 12, maxHeight: 120, overflow: 'auto' }}>
            {digestPreview}
            {digestPreview.length >= 400 ? '…' : ''}
          </pre>
        ) : null}
      </Card>
      <Card title="Continuous assurance" subtitle="Live controls and attestation status">
        {assurance ? (
          <>
            <ul className="insight-callout-list">
              <li>
                Protected traffic: <strong>{assurance.controls.trafficProtected ? 'yes' : 'no'}</strong> ·
                LLM reachable: <strong>{assurance.controls.llmReachable ? 'yes' : 'no'}</strong>
              </li>
              <li>
                Total calls: <strong>{assurance.metrics.totalCalls.toLocaleString()}</strong> · Blocked:{' '}
                <strong>{assurance.metrics.blockedCalls.toLocaleString()}</strong> · Block rate:{' '}
                <strong>{Math.round(assurance.metrics.blockedRate * 100)}%</strong>
              </li>
              <li>
                Avg latency: <strong>{assurance.metrics.avgLatencyMs}ms</strong> · Pending policy suggestions:{' '}
                <strong>{assurance.controls.pendingSuggestions}</strong>
              </li>
              <li>
                Benchmarks: <strong>{assurance.benchmarkSummary.servers}</strong> servers · Needs attention:{' '}
                <strong>{assurance.benchmarkSummary.needsAttention}</strong> · Outperforming:{' '}
                <strong>{assurance.benchmarkSummary.outperforming}</strong>
              </li>
            </ul>
            {assurance.attestations.length > 0 ? (
              <ul className="insight-callout-list">
                {assurance.attestations.map((note) => (
                  <li key={note} className="hint">
                    {note}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <EmptyState title="Continuous assurance report unavailable" />
        )}
      </Card>

      <Card title="Similar-environment benchmarks" subtitle="Adaptive server-level peer comparisons">
        {topBenchmarks.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Server</th>
                  <th>Calls</th>
                  <th>Blocked</th>
                  <th>Latency</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {topBenchmarks.map((row) => (
                  <tr key={row.serverName}>
                    <td>{row.serverName}</td>
                    <td>{row.totalCalls.toLocaleString()}</td>
                    <td>{Math.round(row.blockedRate * 100)}%</td>
                    <td>{row.avgLatencyMs}ms</td>
                    <td>{row.status.replace('_', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No benchmark rows yet" message="Route traffic through Mastyf AI first." />
        )}
      </Card>

      <HealthReportPanel proxyOnline={proxyOnline} onReportLoading={onReportLoading} />

      <ExecutiveOverviewPanel
        refreshKey={refreshKey}
        metrics={metrics ?? undefined}
        semanticFlags={semanticFlags}
      />

      <FullAnalysisDrawer
        open={analysisOpen}
        onClose={() => setAnalysisOpen(false)}
        proxyOnline={proxyOnline}
      />
    </>
  );
}
