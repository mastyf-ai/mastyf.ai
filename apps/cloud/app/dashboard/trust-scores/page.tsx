import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { requireDashboard, trustScores } from '@/lib/dashboard-data';
import { countOf, formatCount } from '@/lib/format';

function gradeClass(grade: string): string {
  const letter = grade.trim().charAt(0).toLowerCase();
  return ['a', 'b', 'c', 'd', 'f'].includes(letter) ? `grade grade--${letter}` : 'grade';
}

export default async function TrustScoresPage() {
  await requireDashboard();
  const scores = await trustScores();

  return (
    <>
      <header className="dhead">
        <div>
          <h1>Trust scores</h1>
          <p>Security scores for MCP server packages, highest first.</p>
        </div>
        <div className="dhead__actions">
          <Link href="/certified" className="btn">
            Look up a package
            <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </div>
      </header>

      <div className="dstack">
        <section className="panel" aria-labelledby="scores">
          <div className="panel__head">
            <h2 id="scores" className="panel__title">
              Packages
            </h2>
            <span className="panel__meta">{formatCount(scores.length)} scored</span>
          </div>
          <div className="panel__body panel__body--flush">
            {scores.length ? (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col" className="num col-opt">
                        #
                      </th>
                      <th scope="col">Package</th>
                      <th scope="col">Grade</th>
                      <th scope="col" className="num">
                        Score
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {scores.map((s, i) => (
                      <tr key={s.packageName}>
                        <td className="num dim col-opt">{i + 1}</td>
                        <td>
                          <code>{s.packageName}</code>
                          <span className="cell-sub">
                            {countOf(s.cveCount, 'CVE')} ({formatCount(s.criticalCveCount)} critical),{' '}
                            {countOf(s.reportCount, 'report')}
                          </span>
                        </td>
                        <td>
                          <span className={gradeClass(s.grade)}>{s.grade}</span>
                        </td>
                        <td className="num">{s.score}/100</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty">
                <strong>No packages scored yet</strong>
                Look one up on the <Link href="/certified">trust scores page</Link>.
              </p>
            )}
          </div>
        </section>

        <p className="notice">
          Scores weigh eight things: known vulnerabilities, authentication, transport security, how much damage the
          tools could do, supply-chain integrity, attack history, response hygiene, and how current the package is.
        </p>
      </div>
    </>
  );
}
