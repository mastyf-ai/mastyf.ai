'use client';

import type { QuarantinePolicyDetail } from '@/lib/guardian-api';

type Props = {
  open: boolean;
  loading: boolean;
  detail: QuarantinePolicyDetail | null;
  error?: string;
  onClose: () => void;
};

function triggeredLabel(kind: string): string {
  if (kind === 'proxy_block') return 'Proxy block';
  if (kind === 'semantic_flag') return 'Semantic flag';
  if (kind === 'threat_intel') return 'Threat intel (CVE/OSV)';
  return kind;
}

export function QuarantinePolicyDrawer({ open, loading, detail, error, onClose }: Props) {
  if (!open) return null;

  const triggered = detail?.triggered;
  const applied = detail?.appliedRule;
  const suggested = detail?.suggestedRule;

  return (
    <aside className="candidate-drawer quarantine-policy-drawer" aria-label="Quarantine policy detail">
      <div className="candidate-drawer-head">
        <h4>Policy — {detail?.id || '…'}</h4>
        <button type="button" className="secondary btn-sm" onClick={onClose}>
          Close
        </button>
      </div>

      {loading ? <p className="hint">Loading policy detail…</p> : null}
      {error ? <p className="status status-error">{error}</p> : null}

      {!loading && !error && detail ? (
        <>
          <div className="candidate-drawer-section">
            <h5>Triggered block</h5>
            {triggered ? (
              <dl className="candidate-drawer-meta">
                <dt>Kind</dt>
                <dd>{triggeredLabel(triggered.kind)}</dd>
                <dt>Summary</dt>
                <dd>{triggered.title}</dd>
                {triggered.ruleName ? (
                  <>
                    <dt>Rule</dt>
                    <dd><code>{triggered.ruleName}</code></dd>
                  </>
                ) : null}
                {triggered.reason ? (
                  <>
                    <dt>Reason</dt>
                    <dd>{triggered.reason}</dd>
                  </>
                ) : null}
                {triggered.toolName ? (
                  <>
                    <dt>Tool</dt>
                    <dd>{triggered.toolName}</dd>
                  </>
                ) : null}
                {triggered.serverName ? (
                  <>
                    <dt>Server</dt>
                    <dd>{triggered.serverName}</dd>
                  </>
                ) : null}
                {triggered.timestamp ? (
                  <>
                    <dt>Event time</dt>
                    <dd>{new Date(triggered.timestamp).toLocaleString()}</dd>
                  </>
                ) : null}
                {triggered.signature ? (
                  <>
                    <dt>Signature</dt>
                    <dd><code>{triggered.signature}</code></dd>
                  </>
                ) : null}
                {triggered.affectedPackage ? (
                  <>
                    <dt>Package</dt>
                    <dd>{triggered.affectedPackage}</dd>
                  </>
                ) : null}
                {triggered.semanticConfidence != null ? (
                  <>
                    <dt>Semantic confidence</dt>
                    <dd>{(triggered.semanticConfidence * 100).toFixed(0)}%</dd>
                  </>
                ) : null}
              </dl>
            ) : (
              <p className="muted">Original trigger context is no longer available (history may have rotated).</p>
            )}
          </div>

          <div className="candidate-drawer-section">
            <h5>Quarantine enforcement</h5>
            <dl className="candidate-drawer-meta">
              <dt>Quarantined at</dt>
              <dd>{new Date(detail.quarantine.quarantinedAt).toLocaleString()}</dd>
              {detail.quarantine.operator ? (
                <>
                  <dt>Operator</dt>
                  <dd>{detail.quarantine.operator}</dd>
                </>
              ) : null}
              {detail.quarantine.appliedRuleName ? (
                <>
                  <dt>Applied rule name</dt>
                  <dd><code>{detail.quarantine.appliedRuleName}</code></dd>
                </>
              ) : null}
              {detail.quarantine.enforcementStatus ? (
                <>
                  <dt>Enforcement</dt>
                  <dd>{detail.quarantine.enforcementStatus}</dd>
                </>
              ) : null}
              {detail.quarantine.enforcementDetail ? (
                <>
                  <dt>Detail</dt>
                  <dd>{detail.quarantine.enforcementDetail}</dd>
                </>
              ) : null}
            </dl>
          </div>

          <div className="candidate-drawer-section">
            <h5>Applied policy rule</h5>
            {applied ? (
              <pre className="code-block">{JSON.stringify(applied, null, 2)}</pre>
            ) : (
              <p className="muted">
                Rule not found in policy file
                {detail.policyPath ? ` (${detail.policyPath})` : ''}. It may have been removed or renamed.
              </p>
            )}
            {!applied && suggested ? (
              <>
                <h5 style={{ marginTop: '0.75rem' }}>Expected rule (from context)</h5>
                <pre className="code-block">{JSON.stringify(suggested, null, 2)}</pre>
              </>
            ) : null}
          </div>

          {detail.policyPath ? (
            <div className="candidate-drawer-section">
              <h5>Policy file</h5>
              <p className="fixture-path">{detail.policyPath}</p>
            </div>
          ) : null}
        </>
      ) : null}
    </aside>
  );
}
