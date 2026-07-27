'use client';

import { useEffect, useState } from 'react';
import { investigateIncident } from '@/lib/mastyf-ai-api';

export type ThreatLabContext = {
  /** Semantic audit / incident id — empty when source is vuln-finding */
  semanticAuditId: string;
  toolName: string;
  category: string;
  narrative?: string;
  incidentId?: string;
  /** Vuln Discovery handoff */
  source?: 'semantic-audit' | 'vuln-finding';
  findingId?: string;
  /** Threat Lab candidate id from propose-block */
  candidateId?: string;
  discoveryLane?: 'advisory' | 'novel-runtime' | 'other';
};

type IntentNode = {
  index: number;
  toolName: string;
  role: string;
  citationId: string;
  sensitiveRead?: boolean;
  encodeHint?: boolean;
  exfilHint?: boolean;
};

type IntentGraph = {
  inferredIntent?: string;
  killChainStages?: string[];
  nodes?: IntentNode[];
  patterns?: Array<{ pattern: string; confidence: number }>;
};

type Investigation = {
  incidentId: string;
  narrative?: string;
  killChainNarrative?: string;
  intentGraph?: IntentGraph;
  citations?: Array<{ id: string; summary: string }>;
  hypotheses?: Array<{ attackClass: string; confidence: number; reasoning: string }>;
  recommendations?: Array<{ action: string; detail: string }>;
};

type Props = {
  triggerId: string;
  onClose: () => void;
  onOpenThreatLab?: (ctx: ThreatLabContext) => void;
};

export function IncidentInvestigatorDrawer({ triggerId, onClose, onOpenThreatLab }: Props) {
  const [loading, setLoading] = useState(true);
  const [investigation, setInvestigation] = useState<Investigation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      const result = await investigateIncident(triggerId);
      if (!cancelled) {
        setInvestigation((result.investigation as Investigation | null) ?? null);
        setError(result.error ?? null);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [triggerId]);

  const openThreatLab = () => {
    if (!investigation || !onOpenThreatLab) return;
    const hyp = investigation.hypotheses?.[0];
    const anchorCitation = investigation.citations?.find((c) => c.id === triggerId);
    const toolFromCitation = anchorCitation?.summary?.split(' on ')[0]?.trim();
    const toolFromGraph = investigation.intentGraph?.nodes?.[0]?.toolName;
    onOpenThreatLab({
      semanticAuditId: triggerId,
      toolName: toolFromCitation || toolFromGraph || 'unknown',
      category: hyp?.attackClass || 'suspicious-activity',
      narrative: investigation.narrative ?? investigation.killChainNarrative,
      incidentId: investigation.incidentId,
    });
  };

  const graph = investigation?.intentGraph;

  return (
    <aside className="threat-drawer incident-drawer" role="dialog" aria-label="Incident investigation">
      <header className="threat-drawer-head">
        <h3>Incident investigation</h3>
        <button type="button" className="secondary btn-sm" onClick={onClose}>
          Close
        </button>
      </header>
      {loading ? <p className="hint">Investigating…</p> : null}
      {!loading && error ? <p className="muted">{error}</p> : null}
      {!loading && !error && !investigation ? (
        <p className="muted">Investigation failed or record not found.</p>
      ) : null}
      {investigation ? (
        <>
          {investigation.killChainNarrative || investigation.narrative ? (
            <p className="insight-callout-list">{investigation.killChainNarrative || investigation.narrative}</p>
          ) : null}
          {graph?.nodes?.length ? (
            <>
              <h4>Agent intent graph</h4>
              {graph.inferredIntent ? <p className="hint">{graph.inferredIntent}</p> : null}
              {graph.killChainStages?.length ? (
                <p className="hint">Stages: {graph.killChainStages.join(' → ')}</p>
              ) : null}
              <ul className="intent-graph-list insight-callout-list">
                {graph.nodes.map((n) => (
                  <li key={n.citationId}>
                    <code>{n.toolName}</code> <span className="badge-role">{n.role}</span>
                    {n.sensitiveRead ? <span className="badge-hint"> sensitive-read</span> : null}
                    {n.encodeHint ? <span className="badge-hint"> encode</span> : null}
                    {n.exfilHint ? <span className="badge-hint"> exfil</span> : null}
                  </li>
                ))}
              </ul>
              {graph.patterns?.length ? (
                <p className="hint">
                  Pattern: {graph.patterns[0]?.pattern} ({Math.round((graph.patterns[0]?.confidence ?? 0) * 100)}%)
                </p>
              ) : null}
            </>
          ) : null}
          {investigation.hypotheses?.length ? (
            <>
              <h4>Hypotheses</h4>
              <ul className="insight-callout-list">
                {investigation.hypotheses.map((h) => (
                  <li key={h.attackClass}>
                    <strong>{h.attackClass}</strong> ({Math.round(h.confidence * 100)}%) — {h.reasoning}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {investigation.citations?.length ? (
            <>
              <h4>Cited records</h4>
              <ul className="insight-callout-list">
                {investigation.citations.map((c) => (
                  <li key={c.id}>
                    <code>{c.id}</code> — {c.summary}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {investigation.recommendations?.length ? (
            <>
              <h4>Recommendations</h4>
              <ul className="insight-callout-list">
                {investigation.recommendations.map((r) => (
                  <li key={r.detail}>
                    [{r.action}] {r.detail}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {onOpenThreatLab ? (
            <div className="btn-row">
              <button type="button" onClick={openThreatLab}>
                Open in Threat Lab
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </aside>
  );
}
