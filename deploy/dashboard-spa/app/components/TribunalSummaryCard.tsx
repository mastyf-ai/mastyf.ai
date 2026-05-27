'use client';

import { useState } from 'react';
import type { TribunalReport } from '@/lib/guardian-api';
import { TRIBUNAL_BATCH_LIMIT } from '@/lib/tribunal-config';

type DebateArgument = {
  persona?: string;
  stance?: string;
  reasoning?: string;
  confidence?: number;
};

type TribunalVerdict = {
  recommendedLabel?: 'true_positive' | 'false_positive' | 'needs_review';
  unanimous?: boolean;
  confidence?: number;
  dissent?: string;
};

type TribunalDebate = {
  recordId?: string;
  toolName?: string;
  serverName?: string;
  uncertaintyScore?: number;
  arguments?: DebateArgument[];
  verdict?: TribunalVerdict;
  transcript?: string;
  generatedAt?: string;
  autoLabelEligible?: boolean;
};

const LABEL_COPY: Record<string, string> = {
  true_positive: 'True positive — treat as a real threat',
  false_positive: 'False positive — likely benign',
  needs_review: 'Needs human review',
};

const PERSONA_LABEL: Record<string, string> = {
  block_advocate: 'Block advocate',
  allow_advocate: 'Allow advocate',
  auditor: 'Auditor (synthesis)',
};

function formatLabel(label: string | undefined): string {
  if (!label) return 'Unknown';
  return LABEL_COPY[label] || label.replace(/_/g, ' ');
}

type Props = {
  tribunal: TribunalReport | null;
  onRunTribunal?: () => void;
  tribunalLoading?: boolean;
  onInvestigateRecord?: (recordId: string) => void;
};

export function TribunalSummaryCard({
  tribunal,
  onRunTribunal,
  tribunalLoading,
  onInvestigateRecord,
}: Props) {
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const debates = (tribunal?.debates as TribunalDebate[]) ?? [];
  const debatedCount = tribunal?.debatedCount ?? debates.length;
  const autoLabels = tribunal?.autoLabelsApplied ?? 0;
  const eligibleTotal = tribunal?.eligibleTotal ?? 0;
  const remainingEligible = tribunal?.remainingEligible ?? 0;
  const generatedAt = tribunal?.generatedAt ?? null;
  const quorumMet = tribunal?.quorumMet === true;
  const hasPriorRun = debates.length > 0 || Boolean(generatedAt);
  const noMoreRemaining = hasPriorRun && remainingEligible === 0;
  const runLabel = tribunalLoading
    ? 'Running…'
    : hasPriorRun && remainingEligible > 0
      ? `Run next batch (up to ${TRIBUNAL_BATCH_LIMIT})`
      : `Run tribunal (up to ${TRIBUNAL_BATCH_LIMIT})`;

  return (
    <article className="enterprise-ai-card tribunal-summary-card">
      <div className="tribunal-summary-head">
        <div>
          <h3>Swarm debate tribunal</h3>
          <p className="hint">
            Three agents (block, allow, auditor) debate uncertain semantic flags and recommend a label.
          </p>
        </div>
        {onRunTribunal ? (
          <button
            type="button"
            className="primary btn-sm"
            disabled={tribunalLoading || noMoreRemaining}
            onClick={onRunTribunal}
          >
            {runLabel}
          </button>
        ) : null}
      </div>

      {noMoreRemaining ? (
        <p className="muted tribunal-queue-empty-hint">
          No more uncertain unlabeled flags in queue — generate borderline traffic or adjust{' '}
          <code>GUARDIAN_SEMANTIC_MIN_CONFIDENCE</code>, then run tribunal again.
        </p>
      ) : null}

      <p className="hint tribunal-how-toggle">
        <button
          type="button"
          className="link-button"
          onClick={() => setShowHowItWorks((v) => !v)}
        >
          {showHowItWorks ? 'Hide' : 'How does this work?'}
        </button>
      </p>

      {showHowItWorks ? (
        <div className="tribunal-how-it-works">
          <ol>
            <li>
              <strong>You do not create debates manually.</strong> Each click runs up to{' '}
              <strong>{TRIBUNAL_BATCH_LIMIT}</strong> debates on the top <strong>unlabeled</strong> semantic
              audits in the uncertain band (confidence near your threshold).
            </li>
            <li>
              After labels are applied (manually or via <code>GUARDIAN_TRIBUNAL_AUTO_LABEL=true</code>), use{' '}
              <em>Run next batch</em> to debate the next highest-uncertainty items.
            </li>
            <li>
              Each debate asks: <em>Was this MCP tool call actually malicious?</em> using proxy block
              context + semantic categories.
            </li>
            <li>
              <strong>Block advocate</strong> argues to block; <strong>allow advocate</strong> argues benign;
              <strong> auditor</strong> recommends <code>true_positive</code>, <code>false_positive</code>,
              or <code>needs_review</code>.
            </li>
            <li>
              Requires semantic async audits — enable <code>GUARDIAN_SEMANTIC_ASYNC</code> and route MCP
              traffic through Guardian first.
            </li>
          </ol>
        </div>
      ) : null}

      {debates.length === 0 ? (
        <p className="muted">
          No debates in the last run.
          {eligibleTotal > 0
            ? ` ${eligibleTotal} eligible flag(s) in queue — run tribunal to start.`
            : ' Generate semantic traffic or lower GUARDIAN_SEMANTIC_MIN_CONFIDENCE to surface borderline flags.'}
        </p>
      ) : (
        <>
          <p className="hint tribunal-run-meta">
            Last run: {generatedAt ? new Date(generatedAt).toLocaleString() : '—'}
            {' · '}
            {debatedCount} debated
            {eligibleTotal > 0 ? ` · ${eligibleTotal} eligible` : ''}
            {remainingEligible > 0
              ? ` · ${remainingEligible} remaining for next batch`
              : ' · queue empty'}
            {autoLabels > 0 ? ` · ${autoLabels} auto-labeled` : ''}
            {quorumMet ? ' · quorum met' : ''}
          </p>

          <ul className="tribunal-debate-list">
            {debates.map((d) => {
              const id = String(d.recordId || d.toolName);
              const expanded = expandedId === id;
              const blockArg = d.arguments?.find((a) => a.persona === 'block_advocate');
              const allowArg = d.arguments?.find((a) => a.persona === 'allow_advocate');
              const subjectLine = [
                d.serverName,
                d.toolName,
                d.uncertaintyScore != null
                  ? `uncertainty ${(d.uncertaintyScore * 100).toFixed(0)}%`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ');

              return (
                <li key={id} className="tribunal-debate-item">
                  <div className="tribunal-debate-header">
                    <div>
                      <strong className="tribunal-debate-subject">Debate: {subjectLine || id}</strong>
                      <p className="hint tribunal-debate-question">
                        Question: Should this tool call be blocked as a threat?
                      </p>
                    </div>
                    <span
                      className={`badge tribunal-verdict-badge verdict-${d.verdict?.recommendedLabel || 'needs_review'}`}
                    >
                      {formatLabel(d.verdict?.recommendedLabel)}
                    </span>
                  </div>

                  <dl className="tribunal-outcome-dl">
                    <dt>Outcome</dt>
                    <dd>
                      {formatLabel(d.verdict?.recommendedLabel)}
                      {d.verdict?.confidence != null
                        ? ` (${(d.verdict.confidence * 100).toFixed(0)}% confidence)`
                        : ''}
                      {d.verdict?.unanimous ? ' · unanimous' : ' · split'}
                      {d.autoLabelEligible ? ' · eligible for auto-label' : ''}
                    </dd>
                    {d.verdict?.dissent ? (
                      <>
                        <dt>Dissent</dt>
                        <dd>{d.verdict.dissent}</dd>
                      </>
                    ) : null}
                    {blockArg?.reasoning ? (
                      <>
                        <dt>Block case</dt>
                        <dd>{blockArg.reasoning}</dd>
                      </>
                    ) : null}
                    {allowArg?.reasoning ? (
                      <>
                        <dt>Allow case</dt>
                        <dd>{allowArg.reasoning}</dd>
                      </>
                    ) : null}
                  </dl>

                  <div className="tribunal-debate-actions">
                    <button
                      type="button"
                      className="secondary btn-sm"
                      onClick={() => setExpandedId(expanded ? null : id)}
                    >
                      {expanded ? 'Hide arguments' : 'Show full arguments'}
                    </button>
                    {onInvestigateRecord && d.recordId ? (
                      <button
                        type="button"
                        className="secondary btn-sm"
                        onClick={() => onInvestigateRecord(d.recordId!)}
                      >
                        Investigate session
                      </button>
                    ) : null}
                  </div>

                  {expanded ? (
                    <div className="tribunal-debate-expanded">
                      {(d.arguments || []).map((arg) => (
                        <div key={arg.persona} className="tribunal-argument">
                          <strong>
                            {PERSONA_LABEL[arg.persona || ''] || arg.persona} ({arg.stance})
                          </strong>
                          <span className="hint">
                            {arg.confidence != null
                              ? ` ${(arg.confidence * 100).toFixed(0)}%`
                              : ''}
                          </span>
                          <p>{arg.reasoning || '—'}</p>
                        </div>
                      ))}
                      {d.transcript ? (
                        <details className="tribunal-transcript-details">
                          <summary>Raw transcript</summary>
                          <pre className="threat-automation-log">{d.transcript}</pre>
                        </details>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </article>
  );
}
