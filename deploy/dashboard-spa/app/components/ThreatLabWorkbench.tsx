'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  acceptThreatLabCandidate,
  rejectThreatLabCandidate,
  runThreatLab,
  trackAdvancedAnalyticsEvent,
  type AutoCorpusEntry,
  type ThreatLabCandidate,
} from '@/lib/mastyf-ai-api';
import { SOURCE_LABELS } from '@/lib/threat-discovery-copy';
import { ThreatCandidateDrawer } from './ThreatCandidateDrawer';
import { IncidentInvestigatorDrawer } from './IncidentInvestigatorDrawer';
import { hasPermission } from '@/lib/dashboard-roles';
import { computeThreatConversionFromCandidates } from '@/lib/advanced-analytics';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Badge, SeverityBadge } from './ui/Badge';
import { KpiCard } from './ui/KpiCard';
import { EmptyState } from './ui/EmptyState';

import type { ThreatLabContext } from './IncidentInvestigatorDrawer';

type Props = {
  candidates: ThreatLabCandidate[];
  autoEntries?: AutoCorpusEntry[];
  roles?: string[];
  preloadedContext?: ThreatLabContext | null;
  manifestMeta?: {
    timestamp?: string;
    mode?: string;
    llmModel?: string;
    llmUsed?: boolean;
    skipped?: string;
    runNote?: string;
  };
  onRefresh?: () => void;
  onClearContext?: () => void;
  onRunStarted?: (msg: string) => void;
};

function findLinkedCandidate(
  candidates: ThreatLabCandidate[],
  ctx: ThreatLabContext,
): ThreatLabCandidate | null {
  if (ctx.source === 'vuln-finding' && ctx.findingId) {
    if (ctx.candidateId) {
      const byId = candidates.find((c) => c.id === ctx.candidateId);
      if (byId) return byId;
    }
    return (
      candidates.find(
        (c) =>
          c.provenance?.inputFingerprint === ctx.findingId
          || c.id === `vuln-block-${ctx.findingId}`
          || (c.provenance?.source === 'vuln-discovery' && c.provenance?.inputFingerprint === ctx.findingId),
      ) ?? null
    );
  }
  return (
    candidates.find(
      (c) =>
        c.provenance?.inputFingerprint === ctx.semanticAuditId
        || (c.provenance?.source === 'semantic-tp' && c.provenance?.inputFingerprint === ctx.semanticAuditId),
    ) ?? null
  );
}

function severityFromConfidence(confidence: number): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (confidence >= 0.7) return 'HIGH';
  if (confidence >= 0.4) return 'MEDIUM';
  return 'LOW';
}

export function ThreatLabWorkbench({
  candidates,
  autoEntries = [],
  roles,
  preloadedContext,
  manifestMeta,
  onRefresh,
  onClearContext,
  onRunStarted,
}: Props) {
  const autoByFingerprint = useMemo(() => {
    const map = new Map<string, AutoCorpusEntry>();
    for (const e of autoEntries) {
      if (e.fingerprint) map.set(e.fingerprint, e);
    }
    return map;
  }, [autoEntries]);

  const [selected, setSelected] = useState<ThreatLabCandidate | null>(null);
  const [investigateId, setInvestigateId] = useState<string | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [busy, setBusy] = useState('');
  const bannerRef = useRef<HTMLDivElement>(null);
  const canMutate = hasPermission(roles, 'policy_mutate');
  const canRun = hasPermission(roles, 'policy_test');
  const semanticTpCount = new Set(
    candidates
      .filter((c) => c.provenance?.source === 'semantic-tp' && c.provenance?.inputFingerprint)
      .map((c) => String(c.provenance?.inputFingerprint)),
  ).size;
  const conversion = computeThreatConversionFromCandidates(candidates, semanticTpCount);
  const pendingCount = candidates.filter((c) => !c.reviewStatus || c.reviewStatus === 'pending').length;

  useEffect(() => {
    void trackAdvancedAnalyticsEvent({
      feature: 'threat_policy_conversion',
      metric: 'conversionRatePct',
      confidence: conversion.caveat.confidence,
      value: Number(conversion.conversionRatePct.toFixed(2)),
    });
  }, [conversion.caveat.confidence, conversion.conversionRatePct]);

  const onAccept = async (id: string) => {
    if (!canMutate) {
      onRunStarted?.('Requires operator role');
      return;
    }
    setBusy(`accept:${id}`);
    const res = await acceptThreatLabCandidate(id);
    if (res.ok) {
      setSelected(null);
      onRefresh?.();
      onRunStarted?.(res.ruleName ? `Accepted — applied ${res.ruleName}` : `Accepted ${id}`);
    } else {
      onRunStarted?.(res.error || `Accept failed for ${id}`);
    }
    setBusy('');
  };

  const onReject = async (id: string) => {
    if (!canMutate) {
      onRunStarted?.('Requires operator role');
      return;
    }
    setBusy(`reject:${id}`);
    const res = await rejectThreatLabCandidate(id);
    if (res.ok) {
      setSelected(null);
      onRefresh?.();
      onRunStarted?.(`Rejected candidate ${id}`);
    } else {
      onRunStarted?.(res.error || `Reject failed for ${id}`);
    }
    setBusy('');
  };

  const runThreatLabReactive = async () => {
    if (!canRun || runBusy) return;
    setRunBusy(true);
    try {
      const res = await runThreatLab('reactive');
      if (res.ok) {
        onRunStarted?.(
          res.jobId
            ? `Threat Lab started (reactive) — job ${res.jobId.slice(0, 8)}…`
            : 'Threat Lab started (reactive)',
        );
        onRefresh?.();
      } else {
        onRunStarted?.(res.error || 'Threat Lab failed to start');
      }
    } finally {
      setRunBusy(false);
    }
  };

  useEffect(() => {
    if (!preloadedContext) return;
    // Vuln findings are not semantic audits — never open Incident Investigator for them
    if (preloadedContext.source === 'vuln-finding') {
      setInvestigateId(null);
    } else if (preloadedContext.semanticAuditId) {
      setInvestigateId(preloadedContext.semanticAuditId);
    }
    const linked = findLinkedCandidate(candidates, preloadedContext);
    if (linked) setSelected(linked);
    requestAnimationFrame(() => {
      bannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, [
    preloadedContext?.semanticAuditId,
    preloadedContext?.findingId,
    preloadedContext?.candidateId,
    preloadedContext?.source,
    candidates,
  ]);

  const investigateDrawer = investigateId ? (
    <IncidentInvestigatorDrawer
      triggerId={investigateId}
      onClose={() => setInvestigateId(null)}
    />
  ) : null;

  return (
    <>
      {preloadedContext ? (
        <div ref={bannerRef} style={{ marginBottom: 'var(--space-4)' }}>
          <Card
            title={
              preloadedContext.source === 'vuln-finding'
                ? 'Vuln Discovery context'
                : 'Incident context'
            }
            subtitle={`${preloadedContext.category} · ${preloadedContext.toolName}`}
            actions={
              onClearContext ? (
                <Button variant="ghost" size="sm" onClick={onClearContext}>
                  Dismiss
                </Button>
              ) : undefined
            }
          >
            <p className="text-sm text-muted" style={{ marginBottom: 'var(--space-3)' }}>
              {preloadedContext.source === 'vuln-finding' ? (
                <>
                  Finding <code className="text-xs">{preloadedContext.findingId}</code>
                  {preloadedContext.discoveryLane
                    ? ` · lane ${preloadedContext.discoveryLane}`
                    : null}
                  {preloadedContext.candidateId
                    ? <> · candidate <code className="text-xs">{preloadedContext.candidateId}</code></>
                    : null}
                  {preloadedContext.narrative ? ` — ${preloadedContext.narrative}` : null}
                  . Accept the linked candidate below to apply the block rule; Reject leaves policy unchanged.
                </>
              ) : (
                <>
                  Semantic audit <code className="text-xs">{preloadedContext.semanticAuditId}</code>
                  {preloadedContext.narrative ? ` — ${preloadedContext.narrative}` : null}
                </>
              )}
            </p>
            <div className="flex gap-2 flex-wrap">
              <Button variant="ghost" size="sm" onClick={() => void onRefresh?.()}>
                Refresh candidates
              </Button>
              {canRun && preloadedContext.source !== 'vuln-finding' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={runBusy}
                  onClick={() => void runThreatLabReactive()}
                >
                  Run Threat Lab (reactive)
                </Button>
              ) : null}
            </div>
          </Card>
        </div>
      ) : null}

      <div className="kpi-grid" style={{ marginBottom: 'var(--space-5)' }}>
        <KpiCard
          label="Threat-to-policy conversion"
          value={`${conversion.conversionRatePct.toFixed(1)}%`}
          secondary="Accepted / total generated"
          accent="info"
        />
        <KpiCard
          label="Median accepted confidence"
          value={`${conversion.medianConfidencePct.toFixed(1)}%`}
          secondary="Accepted candidates"
          accent="success"
        />
        <KpiCard
          label="Review backlog"
          value={`${conversion.reviewBacklogPct.toFixed(1)}%`}
          secondary={`Coverage ${conversion.semanticTpToCandidateCoveragePct.toFixed(1)}%`}
          accent={pendingCount > 0 ? 'warning' : 'neutral'}
        />
        <KpiCard
          label="Pending review"
          value={pendingCount}
          secondary={`${candidates.length} total candidate(s)`}
          accent={pendingCount > 0 ? 'warning' : 'neutral'}
        />
      </div>

      {conversion.caveat.confidence === 'low' ? (
        <div className="banner banner-warning" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="banner-content">
            Low sample confidence (n={conversion.caveat.sampleSize}, coverage {conversion.caveat.coveragePct}%).
            Treat conversion metrics as directional.
          </div>
        </div>
      ) : null}

      {manifestMeta?.runNote || manifestMeta?.skipped ? (
        <div className="banner banner-warning" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="banner-content">{manifestMeta.runNote || manifestMeta.skipped}</div>
        </div>
      ) : null}

      <div className="grid grid-12">
        <div className="col-span-8">
          <Card
            title="Threat Lab candidates"
            subtitle={
              pendingCount > 0
                ? `${pendingCount} pending — accept applies YAML to live policy`
                : 'LLM-proposed rules from discovery runs'
            }
          >
            {candidates.length === 0 ? (
              <EmptyState
                title="No candidates"
                message={
                  preloadedContext
                    ? 'No fixture yet for this audit. Run Threat Lab (reactive) after labeling a semantic true positive.'
                    : 'Run Threat Lab from Pipeline quick actions or start discovery here.'
                }
              />
            ) : (
              <div className="grid grid-2" style={{ gap: 'var(--space-3)' }}>
                {candidates.map((c) => {
                  const isLinked =
                    preloadedContext != null
                    && c.provenance?.inputFingerprint === preloadedContext.semanticAuditId;
                  const status = c.reviewStatus || 'pending';
                  return (
                    <div
                      key={c.id}
                      style={{
                        border: `1px solid ${isLinked ? 'var(--warning)' : 'var(--border)'}`,
                        borderRadius: 'var(--radius-lg)',
                        padding: 'var(--space-4)',
                        background: isLinked ? 'var(--surface-raised)' : undefined,
                      }}
                    >
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <SeverityBadge severity={severityFromConfidence(c.confidence)} />
                        <span className="font-semibold text-sm">{(c.confidence * 100).toFixed(0)}% confidence</span>
                        <Badge
                          variant={
                            status === 'accepted' ? 'success' : status === 'rejected' ? 'danger' : 'warning'
                          }
                        >
                          {status}
                        </Badge>
                      </div>
                      <p className="font-medium text-sm mb-1">{c.attackClass}</p>
                      <p className="text-xs text-muted mb-2">{c.hypothesis.slice(0, 180)}</p>
                      <div className="flex items-center gap-2 text-xs text-muted mb-3">
                        <span>{SOURCE_LABELS[c.provenance?.source || ''] || c.provenance?.source || '—'}</span>
                        <span>·</span>
                        <span>{c.id}</span>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <Button variant="ghost" size="sm" onClick={() => setSelected(c)}>
                          Review
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setInvestigateId(c.id);
                            setSelected(null);
                          }}
                        >
                          Investigate
                        </Button>
                        {status === 'pending' && canMutate ? (
                          <>
                            <Button
                              size="sm"
                              variant="primary"
                              loading={busy === `accept:${c.id}`}
                              disabled={!!busy && busy !== `accept:${c.id}`}
                              onClick={() => void onAccept(c.id)}
                            >
                              Accept
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              loading={busy === `reject:${c.id}`}
                              disabled={!!busy && busy !== `reject:${c.id}`}
                              onClick={() => void onReject(c.id)}
                            >
                              Reject
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        <div className="col-span-4">
          <Card
            title="Discovery"
            subtitle="Reactive mode uses bypasses, semantic true positives, then threat intel"
            actions={
              canRun && !preloadedContext ? (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={runBusy}
                  onClick={() => void runThreatLabReactive()}
                >
                  Start discovery
                </Button>
              ) : undefined
            }
          >
            <p className="text-sm text-muted" style={{ marginBottom: 'var(--space-3)' }}>
              Review candidates carefully — only <strong>accept</strong> applies a generated YAML rule to live policy.
            </p>
            {(manifestMeta?.mode || manifestMeta?.llmModel) ? (
              <dl className="text-sm" style={{ display: 'grid', gap: 'var(--space-2)' }}>
                {manifestMeta.mode ? (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted">Mode</span>
                    <span className="font-medium">{manifestMeta.mode}</span>
                  </div>
                ) : null}
                {manifestMeta.llmModel ? (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted">Model</span>
                    <span className="font-medium">{manifestMeta.llmModel}</span>
                  </div>
                ) : null}
                {manifestMeta.timestamp ? (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted">Manifest</span>
                    <span className="font-medium text-xs">
                      {new Date(manifestMeta.timestamp).toLocaleString()}
                    </span>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="text-xs text-muted">No manifest metadata for the current batch.</p>
            )}
          </Card>

          <Card title="Corpus linkage" subtitle="Auto Research fixtures tied to candidates" style={{ marginTop: 'var(--space-4)' }}>
            {autoEntries.length === 0 ? (
              <p className="text-sm text-muted">No linked auto-corpus entries in this batch.</p>
            ) : (
              <p className="text-sm">
                <span className="font-semibold">{autoEntries.length}</span>
                <span className="text-muted"> fixture(s) available — open Review on a candidate for details.</span>
              </p>
            )}
          </Card>
        </div>
      </div>

      {selected ? (
        <ThreatCandidateDrawer
          candidate={selected}
          autoEntry={selected.fingerprint ? autoByFingerprint.get(selected.fingerprint) : undefined}
          onClose={() => setSelected(null)}
          onAccept={(id) => void onAccept(id)}
          onReject={(id) => void onReject(id)}
          canMutate={canMutate}
        />
      ) : null}
      {investigateDrawer}
    </>
  );
}
