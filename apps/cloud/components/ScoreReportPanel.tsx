import type { ImprovementAction, PublishableIssue, PublishableScoreReport } from '@/lib/score-report';

type Props = {
  report: PublishableScoreReport;
};

const SEV_CLASS: Record<PublishableIssue['severity'], string> = {
  critical: 'issue-critical',
  high: 'issue-high',
  medium: 'issue-medium',
  low: 'issue-low',
  info: 'issue-info',
};

const PRIORITY_LABEL: Record<ImprovementAction['priority'], string> = {
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

export function ScoreReportPanel({ report }: Props) {
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
              {report.categories.map((cat) => (
                <tr key={cat.name}>
                  <td>{cat.name}</td>
                  <td>
                    <span className={`score-pill score-pill-${scoreClass(cat.score)}`}>
                      {cat.score}/100
                    </span>
                  </td>
                  <td>{cat.weightPercent}%</td>
                  <td className="score-points">+{cat.contributionPoints}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="score-report-card">
        <h2 className="score-section-title">Category breakdown</h2>
        <div className="score-category-grid">
          {report.categories.map((cat) => (
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
              <p className="score-category-plain">{cat.plainEnglish}</p>
              {cat.findings.length > 0 ? (
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

      {report.issues.length > 0 ? (
        <section className="score-report-card">
          <h2 className="score-section-title">Issues found</h2>
          <p className="score-section-lead">
            Plain-language findings from the security scan — fix these to improve your score.
          </p>
          <ul className="score-issues">
            {report.issues.map((issue, i) => (
              <li key={`${issue.title}-${i}`} className={`score-issue-card card-elevated ${SEV_CLASS[issue.severity]}`}>
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

      {report.improvementActions.length > 0 ? (
        <section className="score-report-card">
          <h2 className="score-section-title">How to improve your score</h2>
          <ol className="score-actions">
            {report.improvementActions.map((action, i) => (
              <li key={`${action.category}-${i}`} className="score-action-card card-elevated">
                <div className="score-action-top">
                  <span className="score-action-num">{i + 1}</span>
                  <span className={`score-priority priority-${action.priority}`}>
                    {PRIORITY_LABEL[action.priority]}
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
