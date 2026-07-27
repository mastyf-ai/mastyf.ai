'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchVulnFindings,
  fetchVulnFindingAnalysis,
  postVulnAnalyze,
  postVulnValidate,
  postVulnDisclose,
  postVulnReject,
  postVulnApproveAnalysis,
  postVulnProposeBlock,
  postVulnPrepareDisclosure,
  downloadVulnDisclosurePackage,
  getVulnLiveStats,
  isVulnApiError,
  type VulnFindingSummary,
  type VulnAnalysisReport,
  type VulnLiveTrafficStat,
  type VulnDisclosureMeta,
} from '@/lib/mastyf-ai-api';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import type { ThreatLabContext } from '../IncidentInvestigatorDrawer';

type Props = {
  refreshKey: number;
  onAction?: (msg: string) => void;
  onOpenThreatLab?: (ctx: ThreatLabContext) => void;
};

type StatusFilter = 'all' | 'candidate' | 'validated' | 'disclosed' | 'rejected';
type LaneFilter = 'all' | 'advisory' | 'novel-runtime' | 'other';

function severityColor(sev: string): string {
  const u = sev.toUpperCase();
  if (u === 'CRITICAL') return 'var(--danger, #dc2626)';
  if (u === 'HIGH') return 'var(--warning, #ea580c)';
  if (u === 'MEDIUM') return '#ca8a04';
  return 'var(--text-muted)';
}

const btnStyle: {
  padding: string;
  borderRadius: number;
  border: string;
  background: string;
  cursor: string;
  fontSize: number;
} = {
  padding: '4px 8px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'none',
  cursor: 'pointer',
  fontSize: 11,
};

export default function VulnDiscoveryPanel({ refreshKey, onAction, onOpenThreatLab }: Props) {
  const [findings, setFindings] = useState<VulnFindingSummary[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<VulnAnalysisReport | null>(null);
  const [busy, setBusy] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [laneFilter, setLaneFilter] = useState<LaneFilter>('all');
  const [precision, setPrecision] = useState<{
    softDenySkip: number;
    noiseReject: number;
    findingEmit: number;
    promoted: number;
  } | null>(null);
  const [liveStats, setLiveStats] = useState<VulnLiveTrafficStat[]>([]);
  const [disclosureMeta, setDisclosureMeta] = useState<VulnDisclosureMeta | null>(null);
  const [actionError, setActionError] = useState('');
  /** Ignore stale analysis responses when the operator switches findings quickly. */
  const analysisGen = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    const [res, live] = await Promise.all([fetchVulnFindings(), getVulnLiveStats()]);
    setEnabled(!!res?.enabled);
    setFindings(res?.findings || []);
    setPrecision(res?.precision || null);
    setLiveStats(live?.stats || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const filtered = useMemo(() => {
    let list = findings;
    if (filter !== 'all') list = list.filter((f) => f.status === filter);
    if (laneFilter !== 'all') list = list.filter((f) => (f.discoveryLane || 'other') === laneFilter);
    return list;
  }, [findings, filter, laneFilter]);

  const selected = findings.find((f) => f.id === selectedId) || null;
  const matchedAnalysis =
    analysis && selected && analysis.findingId === selected.id ? analysis : null;

  const openAnalysis = async (id: string) => {
    const gen = ++analysisGen.current;
    setSelectedId(id);
    setAnalysis(null);
    setDisclosureMeta(null);
    setBusy('load-analysis');
    setActionError('');
    try {
      const report = await fetchVulnFindingAnalysis(id);
      if (gen !== analysisGen.current) return;
      setAnalysis(report);
    } catch (err) {
      if (gen !== analysisGen.current) return;
      setActionError(err instanceof Error ? err.message : 'Failed to load analysis');
    } finally {
      if (gen === analysisGen.current) setBusy('');
    }
  };

  const runAnalyze = async (id: string) => {
    const gen = ++analysisGen.current;
    setSelectedId(id);
    setBusy('analyze');
    setActionError('');
    try {
      const report = await postVulnAnalyze(id);
      if (gen !== analysisGen.current) return;
      if (isVulnApiError(report)) {
        setActionError(report.error);
        onAction?.(report.error);
        return;
      }
      setAnalysis(report);
      onAction?.(
        report.source === 'template-fallback'
          ? `Template only for ${id.slice(0, 12)}… — ensure Ollama is healthy, then retry Deep analysis`
          : `LLM analysis ready for ${id.slice(0, 12)}…`,
      );
      await load();
    } catch (err) {
      if (gen !== analysisGen.current) return;
      const msg = err instanceof Error ? err.message : 'Analyze request failed';
      setActionError(msg);
      onAction?.(msg);
    } finally {
      if (gen === analysisGen.current) setBusy('');
    }
  };

  const runValidate = async (id: string) => {
    setBusy('validate');
    setActionError('');
    const res = await postVulnValidate(id);
    if (isVulnApiError(res)) {
      setActionError(res.error);
      onAction?.(res.error);
    } else {
      onAction?.(
        res.promoted
          ? `Validated ${id.slice(0, 12)}… — block proposal queued for Threat Lab Accept`
          : res.reason || 'Validation did not promote (need 2/3 signals)',
      );
      await load();
    }
    setBusy('');
  };

  const runReject = async (id: string) => {
    setBusy('reject');
    setActionError('');
    const res = await postVulnReject(id, 'Rejected by operator from Vuln Discovery');
    if (isVulnApiError(res)) {
      setActionError(res.error);
      onAction?.(res.error);
    } else {
      onAction?.(`Rejected ${id.slice(0, 12)}…`);
      if (selectedId === id) {
        setSelectedId(null);
        setAnalysis(null);
      }
      await load();
    }
    setBusy('');
  };

  const runApproveAnalysis = async (id: string) => {
    setSelectedId(id);
    setBusy('approve-analysis');
    setActionError('');
    const report = await postVulnApproveAnalysis(id);
    if (isVulnApiError(report)) {
      setActionError(report.error);
      onAction?.(report.error);
    } else {
      setAnalysis(report);
      onAction?.(`Analysis approved (final) for ${id.slice(0, 12)}…`);
      await load();
    }
    setBusy('');
  };

  const runProposeBlock = async (id: string) => {
    setBusy('propose-block');
    setActionError('');
    const f = findings.find((x) => x.id === id);
    const res = await postVulnProposeBlock(id);
    if (isVulnApiError(res)) {
      setActionError(res.error);
      onAction?.(res.error);
    } else {
      onAction?.(
        `Block proposal ${res.candidateId || 'created'} — open Threat Lab to Accept/Reject policy rule`,
      );
      onOpenThreatLab?.({
        semanticAuditId: '',
        toolName: f?.target?.name || '',
        category: 'vuln-discovery',
        source: 'vuln-finding',
        findingId: id,
        candidateId: res.candidateId,
        discoveryLane: f?.discoveryLane,
      });
    }
    setBusy('');
  };

  const runDisclose = async (id: string) => {
    setBusy('disclose');
    setActionError('');
    const res = await postVulnDisclose(id);
    if (isVulnApiError(res)) {
      setActionError(res.error);
      onAction?.(res.error);
    } else {
      onAction?.(`Marked ${id.slice(0, 12)}… for disclosure`);
      await load();
    }
    setBusy('');
  };

  const runPrepareDisclosure = async (id: string) => {
    setSelectedId(id);
    setBusy('prepare-disclosure');
    setActionError('');
    const res = await postVulnPrepareDisclosure(id);
    if (isVulnApiError(res)) {
      setActionError(res.error);
      onAction?.(res.error);
    } else {
      setDisclosureMeta(res);
      onAction?.(
        res.vendorReady
          ? `Vendor-ready disclosure package for ${id.slice(0, 12)}…`
          : `Preview disclosure package for ${id.slice(0, 12)}… (approve analysis for vendor-ready)`,
      );
      const report = await fetchVulnFindingAnalysis(id);
      if (report) setAnalysis(report);
      await load();
    }
    setBusy('');
  };

  const runDownloadPackage = async (id: string, format: 'zip' | 'json' = 'zip') => {
    setBusy('download');
    setActionError('');
    const res = await downloadVulnDisclosurePackage(id, format);
    if (isVulnApiError(res)) {
      setActionError(res.error);
      onAction?.(res.error);
    } else {
      onAction?.(`Downloaded ${format} package for ${id.slice(0, 12)}…`);
    }
    setBusy('');
  };

  const liveCoverage = useMemo(() => {
    const servers = new Set(liveStats.map((s) => s.serverName));
    const tools = liveStats.length;
    const malicious = liveStats.reduce((n, s) => n + s.maliciousShapedCount, 0);
    const softDeny = liveStats.reduce((n, s) => n + s.softDenyCount, 0);
    const allows = liveStats.reduce((n, s) => n + s.allowCount, 0);
    return { servers: servers.size, tools, malicious, softDeny, allows };
  }, [liveStats]);

  const canDisclose = (f: VulnFindingSummary) => {
    if (f.status !== 'validated') return false;
    if (f.severity === 'CRITICAL' || f.severity === 'HIGH') {
      return f.analysisStatus === 'final';
    }
    return true;
  };

  if (loading) {
    return <div className="p-4 text-muted text-sm">Loading vuln findings…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!enabled && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            background: 'var(--bg-muted)',
            fontSize: 13,
            border: '1px solid var(--border)',
          }}
        >
          Vuln Discovery is <strong>disabled</strong>. Set{' '}
          <code>MASTYF_AI_VULN_DISCOVERY_ENABLED=true</code> and an allowlist to scan. Existing
          stored findings still appear below.
        </div>
      )}

      {actionError && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            background: 'rgba(220,38,38,0.08)',
            border: '1px solid var(--danger, #dc2626)',
            fontSize: 13,
            color: 'var(--danger, #dc2626)',
          }}
        >
          {actionError}
        </div>
      )}

      <Card
        title="Vuln Discovery"
        subtitle="Advisory = npm/OSV/GHSA. Novel/runtime = effect-proven live tap, MCP fuzz, response injection (not soft-deny). Enable MASTYF_AI_VULN_LIVE_TAP=true and/or --mcp-fuzz"
      >
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            marginBottom: 10,
            lineHeight: 1.45,
          }}
        >
          Outdated packages and “Pre-advisory audit” titles are <strong style={{ color: 'var(--text)' }}>published advisories</strong>
          {' '}(often without a CVE id)—not zero-days. Truly novel MCP bugs need live tool fuzz against configured servers.
        </div>
        {precision && (
          <div
            style={{
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
              fontSize: 11,
              color: 'var(--text-muted)',
              marginBottom: 10,
            }}
          >
            <span>Novel emit: {precision.findingEmit}</span>
            <span>Soft-deny skips: {precision.softDenySkip}</span>
            <span>Noise rejects: {precision.noiseReject}</span>
            <span>Promoted: {precision.promoted}</span>
          </div>
        )}
        <div
          style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            fontSize: 11,
            color: 'var(--text-muted)',
            marginBottom: 10,
            padding: '8px 10px',
            background: 'var(--bg-elevated, var(--bg-muted))',
            borderRadius: 6,
            border: '1px solid var(--border)',
          }}
        >
          <span style={{ fontWeight: 600, color: 'var(--text)' }}>Live tap coverage</span>
          <span>Servers: {liveCoverage.servers}</span>
          <span>Tools: {liveCoverage.tools}</span>
          <span>Allows: {liveCoverage.allows}</span>
          <span>Malicious-shaped: {liveCoverage.malicious}</span>
          <span>Soft-deny skips: {liveCoverage.softDeny}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          {(['all', 'advisory', 'novel-runtime', 'other'] as const).map((lane) => (
            <button
              key={lane}
              type="button"
              onClick={() => setLaneFilter(lane)}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: laneFilter === lane ? 'none' : '1px solid var(--border)',
                background: laneFilter === lane ? 'var(--brand-primary)' : 'transparent',
                color: laneFilter === lane ? '#fff' : 'inherit',
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              {lane}
              {' '}
              (
              {lane === 'all'
                ? findings.length
                : findings.filter((x) => (x.discoveryLane || 'other') === lane).length}
              )
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {(['all', 'candidate', 'validated', 'disclosed', 'rejected'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: filter === f ? 'none' : '1px solid var(--border)',
                background: filter === f ? 'var(--brand-primary)' : 'transparent',
                color: filter === f ? '#fff' : 'inherit',
                cursor: 'pointer',
                fontSize: 12,
                textTransform: 'capitalize',
              }}
            >
              {f} ({f === 'all' ? findings.length : findings.filter((x) => x.status === f).length})
            </button>
          ))}
          <button
            type="button"
            onClick={() => void load()}
            style={{
              marginLeft: 'auto',
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'none',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Refresh
          </button>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title="No findings"
            message="Advisory: vuln run --supply-chain-only. Novel: MASTYF_AI_VULN_LIVE_TAP=true on proxy traffic, and/or vuln run --mcp-fuzz (effect-proven only)."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map((f) => (
              <div
                key={f.id}
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                  padding: 12,
                  background:
                    selectedId === f.id
                      ? 'var(--bg-elevated, var(--bg-muted))'
                      : 'var(--bg-muted)',
                  borderRadius: 8,
                  cursor: 'pointer',
                  border:
                    selectedId === f.id
                      ? '1px solid var(--brand-primary)'
                      : '1px solid transparent',
                }}
                onClick={() => void openAnalysis(f.id)}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: severityColor(f.severity),
                    minWidth: 64,
                  }}
                >
                  {f.severity}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{f.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    <span
                      style={{
                        display: 'inline-block',
                        marginRight: 6,
                        padding: '1px 6px',
                        borderRadius: 4,
                        border: '1px solid var(--border)',
                        fontSize: 10,
                        fontWeight: 600,
                        color:
                          f.discoveryLane === 'novel-runtime'
                            ? 'var(--brand-primary, #2563eb)'
                            : f.discoveryLane === 'advisory'
                              ? 'var(--text-muted)'
                              : 'inherit',
                      }}
                    >
                      {f.discoveryLane === 'novel-runtime'
                        ? 'novel/runtime'
                        : f.discoveryLane === 'advisory'
                          ? 'advisory'
                          : f.class}
                    </span>
                    {f.class} · {f.status} · {f.target?.name}
                    {f.scanner ? ` · ${f.scanner}` : ''}
                    {f.hasAnalysisReport
                      ? ` · Analysis ${f.analysisStatus || 'ready'}`
                      : ''}
                  </div>
                </div>
                <div
                  style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {f.status === 'candidate' && (
                    <>
                      <button type="button" disabled={!!busy} onClick={() => void runValidate(f.id)} style={btnStyle}>
                        Validate
                      </button>
                      <button type="button" disabled={!!busy} onClick={() => void runReject(f.id)} style={btnStyle}>
                        Reject
                      </button>
                    </>
                  )}
                  <button type="button" disabled={!!busy} onClick={() => void runAnalyze(f.id)} style={btnStyle}>
                    Deep analysis
                  </button>
                  {f.hasAnalysisReport && f.analysisStatus !== 'final' && (
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => void runApproveAnalysis(f.id)}
                      style={btnStyle}
                    >
                      Approve analysis
                    </button>
                  )}
                  {f.status !== 'rejected' && (
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => void runProposeBlock(f.id)}
                      style={btnStyle}
                    >
                      Propose block
                    </button>
                  )}
                  {canDisclose(f) && (
                    <button type="button" disabled={!!busy} onClick={() => void runDisclose(f.id)} style={btnStyle}>
                      Disclose
                    </button>
                  )}
                  {f.hasAnalysisReport && (
                    <>
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => void runPrepareDisclosure(f.id)}
                        style={btnStyle}
                      >
                        Prepare disclosure
                      </button>
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => void runDownloadPackage(f.id, 'zip')}
                        style={btnStyle}
                      >
                        Download zip
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      onOpenThreatLab?.({
                        source: 'vuln-finding',
                        findingId: f.id,
                        toolName: f.target?.name || 'unknown',
                        category: f.class,
                        narrative: f.title,
                        semanticAuditId: '',
                      })
                    }
                    style={btnStyle}
                  >
                    Threat Lab
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {selected && (
        <Card
          title={`Report: ${selected.title.slice(0, 80)}`}
          subtitle={`${selected.id} · ${selected.status}${matchedAnalysis?.status ? ` · analysis ${matchedAnalysis.status}` : ''}`}
        >
          {busy === 'load-analysis' || busy === 'analyze' || busy === 'approve-analysis' || busy === 'prepare-disclosure' ? (
            <div className="text-sm text-muted">
              {busy === 'analyze'
                ? 'Running LLM deep analysis via Ollama (can take 1–3 min)…'
                : busy === 'prepare-disclosure'
                  ? 'Preparing disclosure package (3-pass analysis if needed)…'
                  : 'Loading analysis…'}
            </div>
          ) : matchedAnalysis?.fullText ? (
            <>
              <div
                style={{
                  fontSize: 12,
                  marginBottom: 12,
                  padding: 10,
                  background: 'var(--bg-muted)',
                  borderRadius: 8,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ fontWeight: 600 }}>Operator checklist</div>
                <div style={{ color: 'var(--text-muted)' }}>
                  Status <strong style={{ color: 'var(--text)' }}>{selected.status}</strong>
                  {' · '}
                  Scanner {selected.target?.name ? `· target ${selected.target.name}` : ''}
                  {matchedAnalysis.citations?.length
                    ? ` · ${matchedAnalysis.citations.length} citation(s)`
                    : ''}
                </div>
                <div style={{ color: 'var(--text-muted)' }}>
                  Analysis confidence{' '}
                  <strong style={{ color: 'var(--text)' }}>
                    {matchedAnalysis.confidence != null ? matchedAnalysis.confidence.toFixed(2) : '—'}
                  </strong>
                  {' · '}
                  {matchedAnalysis.status === 'final' ? 'approved (final)' : 'draft — approve before CRITICAL/HIGH disclose'}
                </div>
                <div style={{ color: 'var(--text-muted)' }}>
                  Block rules apply only via Threat Lab <strong style={{ color: 'var(--text)' }}>Accept</strong>{' '}
                  after Propose block.
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {selected.status !== 'rejected' && (
                    <button type="button" disabled={!!busy} style={btnStyle} onClick={() => void runReject(selected.id)}>
                      Reject finding
                    </button>
                  )}
                  {matchedAnalysis.status !== 'final' && (
                    <button
                      type="button"
                      disabled={!!busy}
                      style={btnStyle}
                      onClick={() => void runApproveAnalysis(selected.id)}
                    >
                      Approve analysis
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={!!busy}
                    style={btnStyle}
                    onClick={() => void runProposeBlock(selected.id)}
                  >
                    Propose block
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    style={btnStyle}
                    onClick={() => void runPrepareDisclosure(selected.id)}
                  >
                    Prepare disclosure package
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    style={btnStyle}
                    onClick={() => void runDownloadPackage(selected.id, 'zip')}
                  >
                    Download zip
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    style={btnStyle}
                    onClick={() => void runDownloadPackage(selected.id, 'json')}
                  >
                    Download json
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    style={btnStyle}
                    onClick={() =>
                      onOpenThreatLab?.({
                        source: 'vuln-finding',
                        findingId: selected.id,
                        toolName: selected.target?.name || 'unknown',
                        category: selected.class,
                        narrative: selected.title,
                        semanticAuditId: '',
                      })
                    }
                  >
                    Accept block in Threat Lab
                  </button>
                </div>
              </div>
              {disclosureMeta && disclosureMeta.findingId === selected.id && (
                <div
                  style={{
                    fontSize: 12,
                    marginBottom: 10,
                    padding: 8,
                    borderRadius: 6,
                    background: 'var(--bg-muted)',
                    color: 'var(--text-muted)',
                  }}
                >
                  Disclosure package:{' '}
                  <strong style={{ color: 'var(--text)' }}>
                    {disclosureMeta.vendorReady ? 'vendor-ready' : 'preview'}
                  </strong>
                  {' · '}
                  CVE {disclosureMeta.cveStatus}
                  {disclosureMeta.relatedCve ? ` (${disclosureMeta.relatedCve})` : ' (none — request from a CNA)'}
                  {disclosureMeta.analysisStatus
                    ? ` · analysis ${disclosureMeta.analysisStatus}`
                    : ''}
                </div>
              )}
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                Confidence {matchedAnalysis.confidence != null ? matchedAnalysis.confidence.toFixed(2) : '—'} ·{' '}
                {matchedAnalysis.provider || 'template'} / {matchedAnalysis.model || 'n/a'}
                {matchedAnalysis.source === 'template-fallback' ? ' · template (not LLM)' : ' · LLM'}
              </div>
              {matchedAnalysis.source === 'template-fallback' && (
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--danger, #dc2626)',
                    marginBottom: 10,
                    padding: 8,
                    background: 'color-mix(in srgb, var(--danger, #dc2626) 8%, transparent)',
                    borderRadius: 6,
                  }}
                >
                  This is an offline template report (not LLM). Confirm Ollama is running
                  (<code>ollama serve</code>, model <code>qwen3:8b</code>), then click{' '}
                  <strong>Deep analysis</strong> / Retry — do not approve template reports as final.
                </div>
              )}
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  fontSize: 12,
                  lineHeight: 1.5,
                  maxHeight: 480,
                  overflow: 'auto',
                  margin: 0,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                }}
              >
                {matchedAnalysis.fullText}
              </pre>
              <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {matchedAnalysis.sections?.executiveSummary && (
                  <button
                    type="button"
                    style={btnStyle}
                    onClick={() => {
                      void navigator.clipboard?.writeText(matchedAnalysis.sections.executiveSummary);
                      onAction?.('Executive summary copied');
                    }}
                  >
                    Copy executive summary
                  </button>
                )}
                {matchedAnalysis.status !== 'final' && (
                  <button
                    type="button"
                    disabled={!!busy}
                    style={btnStyle}
                    onClick={() => void runApproveAnalysis(selected.id)}
                  >
                    Approve analysis
                  </button>
                )}
                <button
                  type="button"
                  disabled={!!busy}
                  style={btnStyle}
                  onClick={() => void runProposeBlock(selected.id)}
                >
                  Propose block
                </button>
                {matchedAnalysis.source === 'template-fallback' && (
                  <button
                    type="button"
                    disabled={!!busy}
                    style={btnStyle}
                    onClick={() => void runAnalyze(selected.id)}
                  >
                    Retry Deep analysis (LLM)
                  </button>
                )}
              </div>
            </>
          ) : (
            <EmptyState
              title="No analysis yet"
              message='Click "Deep analysis" to generate an LLM report. Ollama must be running (LLM is required by default).'
            />
          )}
        </Card>
      )}
    </div>
  );
}
