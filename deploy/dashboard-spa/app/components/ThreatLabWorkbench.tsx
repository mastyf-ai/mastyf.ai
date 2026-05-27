'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  acceptThreatLabCandidate,
  fetchThreatDiscoveryStatus,
  rejectThreatLabCandidate,
  runThreatLab,
  type AutoCorpusEntry,
  type ThreatLabCandidate,
} from '@/lib/guardian-api';
import { SOURCE_LABELS } from '@/lib/threat-discovery-copy';
import { ThreatCandidateDrawer } from './ThreatCandidateDrawer';
import { IncidentInvestigatorDrawer } from './IncidentInvestigatorDrawer';
import { hasPermission } from '@/lib/dashboard-roles';

import type { ThreatLabContext } from './IncidentInvestigatorDrawer';

function fixtureCell(c: ThreatLabCandidate): string {
  if (c.path) {
    const id = c.id.startsWith('adv-') ? c.id : c.path.split('/').pop() || c.id;
    return id;
  }
  if (c.advWriteSkipped) {
    const short = c.advWriteSkipped.length > 28 ? `${c.advWriteSkipped.slice(0, 28)}…` : c.advWriteSkipped;
    return short;
  }
  return '—';
}

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
  return (
    candidates.find(
      (c) =>
        c.provenance?.inputFingerprint === ctx.semanticAuditId
        || (c.provenance?.source === 'semantic-tp' && c.provenance?.inputFingerprint === ctx.semanticAuditId),
    ) ?? null
  );
}

function investigateTriggerId(c: ThreatLabCandidate): string {
  if (c.provenance?.source === 'semantic-tp' && c.provenance?.inputFingerprint) {
    return c.provenance.inputFingerprint;
  }
  return c.provenance?.inputFingerprint || c.id;
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
  const bannerRef = useRef<HTMLElement>(null);
  const canMutate = hasPermission(roles, 'policy_mutate');
  const canRun = hasPermission(roles, 'policy_test');

  const onAccept = async (id: string) => {
    const ok = await acceptThreatLabCandidate(id);
    if (ok) {
      setSelected(null);
      onRefresh?.();
    }
  };

  const onReject = async (id: string) => {
    const ok = await rejectThreatLabCandidate(id);
    if (ok) {
      setSelected(null);
      onRefresh?.();
    }
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
        for (let i = 0; i < 45; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          onRefresh?.();
          const { status } = await fetchThreatDiscoveryStatus();
          const job = status?.jobs?.threatLab;
          if (job && job.state !== 'running') {
            if (job.state === 'failed') {
              onRunStarted?.(job.error || 'Threat Lab job failed — see Overview job log');
            } else {
              const n = status?.threatLab.manifest?.candidates?.length ?? 0;
              const note = status?.threatLab.manifest?.runNote || status?.threatLab.manifest?.skipped;
              onRunStarted?.(
                n > 0
                  ? `Threat Lab finished: ${n} candidate(s) ready for review`
                  : note
                    ? `Threat Lab finished with 0 candidates — ${note}`
                    : 'Threat Lab finished with 0 candidates — label semantic true positives or run Security Swarm for bypasses',
              );
            }
            break;
          }
        }
      } else {
        onRunStarted?.(res.error || 'Threat Lab failed to start');
      }
    } finally {
      setRunBusy(false);
    }
  };

  useEffect(() => {
    if (!preloadedContext) return;
    setInvestigateId(preloadedContext.semanticAuditId);
    const linked = findLinkedCandidate(candidates, preloadedContext);
    if (linked) setSelected(linked);
    requestAnimationFrame(() => {
      bannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, [preloadedContext?.semanticAuditId, candidates]);

  const contextActions = preloadedContext ? (
    <div className="btn-row" style={{ marginTop: 8 }}>
      <button type="button" className="secondary btn-sm" onClick={() => void onRefresh?.()}>
        Refresh candidates
      </button>
      {canRun ? (
        <button
          type="button"
          className="primary btn-sm"
          disabled={runBusy}
          onClick={() => void runThreatLabReactive()}
        >
          {runBusy ? 'Starting…' : 'Run Threat Lab (reactive)'}
        </button>
      ) : null}
      {onClearContext ? (
        <button type="button" className="secondary btn-sm" onClick={onClearContext}>
          Dismiss context
        </button>
      ) : null}
    </div>
  ) : null;

  const investigateDrawer = investigateId ? (
    <IncidentInvestigatorDrawer
      triggerId={investigateId}
      onClose={() => setInvestigateId(null)}
    />
  ) : null;

  return (
    <div className="threat-lab-workbench">
      {preloadedContext ? (
        <aside ref={bannerRef} className="threat-lab-context-banner">
          <strong>Incident context</strong>
          <p>
            Semantic audit <code>{preloadedContext.semanticAuditId}</code> · {preloadedContext.category} ·{' '}
            {preloadedContext.toolName}
          </p>
          {preloadedContext.narrative ? <p className="hint">{preloadedContext.narrative}</p> : null}
          {contextActions}
        </aside>
      ) : null}
      <div className="tribunal-summary-head" style={{ marginBottom: 8 }}>
        <p className="hint" style={{ margin: 0, flex: 1 }}>
          LLM-proposed policy rules: <strong>pending</strong> until you accept (applies YAML to live policy).
          Reactive mode uses bypasses, then <strong>labeled semantic true positives</strong>, then threat intel.
          {manifestMeta?.mode ? ` Mode: ${manifestMeta.mode}.` : ''}
          {manifestMeta?.llmModel ? ` Model: ${manifestMeta.llmModel}.` : ''}
        </p>
        {canRun && !preloadedContext ? (
          <button
            type="button"
            className="primary btn-sm"
            disabled={runBusy}
            onClick={() => void runThreatLabReactive()}
          >
            {runBusy ? 'Running…' : 'Run Threat Lab (reactive)'}
          </button>
        ) : null}
      </div>
      {manifestMeta?.runNote || manifestMeta?.skipped ? (
        <p className="hint status-warning">{manifestMeta.runNote || manifestMeta.skipped}</p>
      ) : null}
      {candidates.length === 0 ? (
        <>
          {preloadedContext ? (
            <p className="muted">
              No fixture yet for this audit — run Threat Lab (reactive) after labeling a semantic true positive,
              or check the Overview session banner if batch data is hidden.
            </p>
          ) : (
            <p className="muted">No Threat Lab candidates yet. Run Threat Lab from Overview.</p>
          )}
          {investigateDrawer}
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
        </>
      ) : (
        <div className="workbench-layout">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Source</th>
                <th>Attack class</th>
                <th>Confidence</th>
                <th>Fixture</th>
                <th>Policy</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => {
                const isLinked =
                  preloadedContext != null
                  && c.provenance?.inputFingerprint === preloadedContext.semanticAuditId;
                return (
                  <tr key={c.id} className={isLinked ? 'row-highlight' : undefined}>
                    <td>{c.id}</td>
                    <td>{SOURCE_LABELS[c.provenance?.source || ''] || c.provenance?.source || '—'}</td>
                    <td className="cell-truncate" title={c.attackClass}>
                      {c.attackClass.slice(0, 40)}
                      {c.attackClass.length > 40 ? '…' : ''}
                    </td>
                    <td>{(c.confidence * 100).toFixed(0)}%</td>
                    <td className="cell-truncate" title={c.path || c.advWriteSkipped || ''}>
                      {fixtureCell(c)}
                    </td>
                    <td>{c.reviewStatus || 'pending'}</td>
                    <td>
                      <div className="btn-row" style={{ marginTop: 0 }}>
                        <button type="button" className="secondary btn-sm" onClick={() => setSelected(c)}>
                          Details
                        </button>
                        <button
                          type="button"
                          className="secondary btn-sm"
                          onClick={() => {
                            setInvestigateId(investigateTriggerId(c));
                            setSelected(null);
                          }}
                        >
                          Investigate
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {selected ? (
            <ThreatCandidateDrawer
              candidate={selected}
              autoEntry={
                selected.fingerprint ? autoByFingerprint.get(selected.fingerprint) : undefined
              }
              onClose={() => setSelected(null)}
              onAccept={(id) => void onAccept(id)}
              onReject={(id) => void onReject(id)}
              canMutate={canMutate}
            />
          ) : null}
          {investigateDrawer}
        </div>
      )}
    </div>
  );
}
