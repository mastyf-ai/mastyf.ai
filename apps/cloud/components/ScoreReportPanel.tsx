import { Check, ChevronDown, X } from 'lucide-react';
import type { PublishableScoreReport } from '@/lib/score-report';

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

const SEVERITY: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Note',
};

const EFFORT: Record<string, string> = {
  hours: 'a few hours',
  days: 'a few days',
  weeks: 'a few weeks',
};

/**
 * The score explained: what each part contributed (one list, details on open), what a live attack
 * test found, what is wrong, and what would raise the score.
 */
export function ScoreReportPanel({ report, probe }: Props) {
  const categories = [...(report.categories ?? [])].sort(
    (a, b) => (b.contributionPoints ?? 0) - (a.contributionPoints ?? 0),
  );
  const issues = report.issues ?? [];
  const actions = report.improvementActions ?? [];

  return (
    <>
      <section className="pkg-section" aria-labelledby="pkg-parts">
        <h2 id="pkg-parts">How the score adds up</h2>
        <ul className="pkg-parts">
          {categories.map((cat) => {
            const points = cat.contributionPoints ?? Math.round(cat.score * (cat.weight ?? 0));
            const weight = cat.weightPercent ?? Math.round((cat.weight ?? 0) * 100);
            const hasDetail = Boolean(cat.plainEnglish) || cat.findings?.length > 0;
            return (
              <li key={cat.name}>
                <details className="pkg-part">
                  <summary>
                    <span className="pkg-part__name">{cat.name}</span>
                    <span className="pkg-part__bar" aria-hidden="true">
                      <span style={{ width: `${cat.score}%` }} />
                    </span>
                    <span className="pkg-part__score">
                      {cat.score}
                      <span className="sr-only"> out of 100</span>
                    </span>
                    <span className="pkg-part__points" title={`Counts for ${weight}% of the total`}>
                      +{points}
                    </span>
                    {hasDetail ? <ChevronDown className="pkg-part__chev" size={16} aria-hidden="true" /> : <span />}
                  </summary>
                  {hasDetail ? (
                    <div className="pkg-part__detail">
                      {cat.plainEnglish ? <p>{cat.plainEnglish}</p> : null}
                      {cat.findings?.length > 0 ? (
                        <ul>
                          {cat.findings.map((f) => (
                            <li key={f}>{f}</li>
                          ))}
                        </ul>
                      ) : null}
                      <p className="pkg-part__weight">Counts for {weight}% of the total.</p>
                    </div>
                  ) : null}
                </details>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="pkg-section" aria-labelledby="pkg-live">
        <h2 id="pkg-live">Live attack test</h2>
        {probe ? (
          <ul className="pkg-probe">
            <ProbeTile ok={!probe.error} value={probe.error ? 'Failed' : 'Started'} label="Server started and answered">
              {probe.error}
            </ProbeTile>
            <ProbeTile
              ok={(probe.rejected ?? 0) > 0}
              value={`${probe.rejected ?? 0} of ${probe.attempted ?? 0}`}
              label="Test attacks refused"
            />
            <ProbeTile ok={!probe.reflected} value={String(probe.reflected ?? 0)} label="Attacks echoed back unfiltered" />
            <ProbeTile ok={!probe.secretLeaks} value={String(probe.secretLeaks ?? 0)} label="Secrets leaked in its output" />
          </ul>
        ) : (
          <p className="pkg-quiet">
            Not tested live yet. This score comes from the published package alone. A live scan starts the server and
            sends test attacks to it.
          </p>
        )}
      </section>

      {issues.length > 0 ? (
        <section className="pkg-section" aria-labelledby="pkg-issues">
          <h2 id="pkg-issues">What to fix</h2>
          <ul className="pkg-issues">
            {issues.map((issue, i) => (
              <li key={`${issue.title}-${i}`} className="pkg-issue" data-sev={issue.severity}>
                <p className="pkg-issue__sev">{SEVERITY[issue.severity] ?? issue.severity}</p>
                <h3>{issue.title}</h3>
                <p>{issue.plainEnglish}</p>
                {issue.fixHint ? <p className="pkg-issue__fix">{issue.fixHint}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {actions.length > 0 ? (
        <section className="pkg-section" aria-labelledby="pkg-raise">
          <h2 id="pkg-raise">How to raise it</h2>
          <ol className="pkg-raise">
            {actions.map((action, i) => (
              <li key={`${action.category}-${i}`}>
                <span className="pkg-raise__gain">+{action.expectedScoreIncrease}</span>
                <span>
                  <p>{action.action}</p>
                  <p className="pkg-raise__effort">Takes {EFFORT[action.effort] ?? action.effort}</p>
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </>
  );
}

function ProbeTile({
  ok,
  value,
  label,
  children,
}: {
  ok: boolean;
  value: string;
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="pkg-probe__tile" data-ok={ok}>
      <span className="pkg-probe__icon" aria-hidden="true">
        {ok ? <Check size={14} strokeWidth={2.5} /> : <X size={14} strokeWidth={2.5} />}
      </span>
      <strong>{value}</strong>
      <span>{label}</span>
      {children ? <span className="pkg-probe__note">{children}</span> : null}
    </li>
  );
}
