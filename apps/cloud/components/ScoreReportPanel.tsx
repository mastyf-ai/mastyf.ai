import type { ImprovementAction, PublishableIssue, PublishableScoreReport } from '@/lib/score-report';

type ProbeData = {
  error?: string;
  rejected?: number;
  attempted?: number;
  reflected?: number;
  secretLeaks?: number;
};

type Props = {
  report: PublishableScoreReport;
  probe?: ProbeData;
};

const SEV_CLASS: Record<string, string> = {
  critical: 'issue-critical',
  high: 'issue-high',
  medium: 'issue-medium',
  low: 'issue-low',
  info: 'issue-info',
};

const PRIORITY_LABEL: Record<string, string> = {
  immediate: 'Fix now',
  high: 'High priority',
  medium: 'Recommended',
  low: 'Nice to have',
};

function scoreClass(score: number): string {
  if (score >= 70) return 'good';
  if (score >= 40) return 'warn';
  return 'bad';
}

export function ScoreReportPanel({ report, probe }: Props) {
  const categories = report.categories ?? [];
  const issues = report.issues ?? [];
  const actions = report.improvementActions ?? [];

  return (
    <div className="score-report">
      <section className="score-report-card card-elevated">
        <h2 className="score-section-title">Why this score?</h2>
        <p className="score-report-summary">{report.summaryPlainEnglish}</p>

        <h3 className="score-report-subtitle">How the {report.overallScore}/100 is calculated</h3>
        <div className="score-table-wrap">
          <table className="score-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Score</th>
                <th>Weight</th>
                <th>Points</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => (
                <tr key={cat.name}>
                  <td>{cat.name}</td>
                  <td>
                    <span className={`score-pill score-pill-${scoreClass(cat.score)}`}>
                      {cat.score}/100
                    </span>
                  </td>
                  <td>{cat.weightPercent ?? `${Math.round((cat.weight ?? 0) * 100)}%`}</td>
                  <td className="score-points">+{cat.contributionPoints ?? Math.round(cat.score * (cat.weight ?? 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {probe ? (
        <section className="score-report-card card-elevated">
          <h2 className="score-section-title">Attack probe results</h2>
          <p className="score-section-lead">
            Live behavioral test — the scanner sent malicious payloads to the running server and measured what happened.
          </p>
          <div className="score-check-list">
            <div className={`score-check-item ${probe.error ? 'fail' : 'pass'}`}>
              <span className="score-check-icon" aria-hidden>{probe.error ? '✗' : '✓'}</span>
              <div>
                <strong>Handshake</strong>
                <p>{probe.error ?? 'Completed successfully'}</p>
              </div>
            </div>
            <div className={`score-check-item ${probe.rejected && probe.rejected > 0 ? 'pass' : 'fail'}`}>
              <span className="score-check-icon" aria-hidden>{probe.rejected && probe.rejected > 0 ? '✓' : '✗'}</span>
              <div>
                <strong>Payloads rejected</strong>
                <p>{probe.rejected ?? 0} of {probe.attempted ?? 0} malicious probe(s) blocked</p>
              </div>
            </div>
            <div className={`score-check-item ${probe.reflected && probe.reflected > 0 ? 'fail' : 'pass'}`}>
              <span className="score-check-icon" aria-hidden>{probe.reflected && probe.reflected > 0 ? '✗' : '✓'}</span>
              <div>
                <strong>Payloads reflected</strong>
                <p>{probe.reflected ?? 0} malicious payload(s) reflected back unfiltered</p>
              </div>
            </div>
            <div className={`score-check-item ${probe.secretLeaks && probe.secretLeaks > 0 ? 'fail' : 'pass'}`}>
              <span className="score-check-icon" aria-hidden>{probe.secretLeaks && probe.secretLeaks > 0 ? '✗' : '✓'}</span>
              <div>
                <strong>Secret leaks</strong>
                <p>{probe.secretLeaks ?? 0} environment variable(s) leaked via tool output</p>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="score-report-card">
        <h2 className="score-section-title">Category breakdown</h2>
        <div className="score-category-grid">
          {categories.map((cat) => (
            <article key={cat.name} className="score-category-card card-elevated">
              <div className="score-category-head">
                <strong>{cat.name}</strong>
                <span className={`score-pill score-pill-${scoreClass(cat.score)}`}>
                  {cat.score}/100
                </span>
              </div>
              <div className="score-bar-track">
                <div
                  className={`score-bar-fill score-bar-${scoreClass(cat.score)}`}
                  style={{ width: `${cat.score}%` }}
                />
              </div>
              {cat.plainEnglish && (
                <p className="score-category-plain">{cat.plainEnglish}</p>
              )}
              {cat.findings?.length > 0 ? (
                <ul className="score-findings">
                  {cat.findings.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      {issues.length > 0 ? (
        <section className="score-report-card">
          <h2 className="score-section-title">Issues found</h2>
          <p className="score-section-lead">
            Plain-language findings from the security scan — fix these to improve your score.
          </p>
          <ul className="score-issues">
            {issues.map((issue, i) => (
              <li key={`${issue.title}-${i}`} className={`score-issue-card card-elevated ${SEV_CLASS[issue.severity] ?? ''}`}>
                <div className="score-issue-head">
                  <span className="score-sev">{issue.severity}</span>
                  <strong>{issue.title}</strong>
                </div>
                <p>{issue.plainEnglish}</p>
                <p className="score-fix">
                  <strong>How to fix:</strong> {issue.fixHint}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {actions.length > 0 ? (
        <section className="score-report-card">
          <h2 className="score-section-title">How to improve your score</h2>
          <ol className="score-actions">
            {actions.map((action, i) => (
              <li key={`${action.category}-${i}`} className="score-action-card card-elevated">
                <div className="score-action-top">
                  <span className="score-action-num">{i + 1}</span>
                  <span className={`score-priority priority-${action.priority}`}>
                    {PRIORITY_LABEL[action.priority] ?? action.priority}
                  </span>
                </div>
                <p className="score-action-text">{action.action}</p>
                <p className="score-action-meta">
                  Est. +{action.expectedScoreIncrease} points · ~{action.effort}
                </p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}