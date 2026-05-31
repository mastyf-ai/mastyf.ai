'use client';

import { useEffect, useState } from 'react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { fetchPlanComplianceAudit, type PlanComplianceReport } from '@/lib/guardian-api';

type Props = { refreshKey?: number };

export function PlanCompliancePanel({ refreshKey = 0 }: Props) {
  const [report, setReport] = useState<PlanComplianceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setReport(await fetchPlanComplianceAudit());
    } catch {
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [refreshKey]);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Industry Roadmap Compliance (A1–C5)</h3>
        <button
          type="button"
          className="px-2 py-1 text-xs border rounded disabled:opacity-50"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? 'Auditing…' : 'Re-run audit'}
        </button>
      </div>
      {!report ? (
        <p className="text-sm text-muted-foreground">{loading ? 'Running compliance audit…' : 'Audit unavailable.'}</p>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <span className="text-4xl font-bold">{report.overallScore}%</span>
            <div className="text-sm">
              <Badge tone={report.productionReady ? 'success' : 'warn'}>
                {report.productionReady ? 'Production ready' : 'Gaps remain'}
              </Badge>
              <p className="text-muted-foreground mt-1">{report.summary}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 text-xs">
            {report.modules.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`p-2 rounded border text-left ${expanded === m.id ? 'border-primary' : 'border-border'}`}
                onClick={() => setExpanded(expanded === m.id ? null : m.id)}
              >
                <span className="font-mono font-semibold">{m.id}</span>
                <span className="block text-lg font-bold">{m.score}%</span>
              </button>
            ))}
          </div>
          {expanded && (
            <div className="text-sm border-t border-border pt-2 space-y-1">
              {report.modules
                .find((m) => m.id === expanded)
                ?.checks.map((c) => (
                  <p key={c.id} className={c.passed ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'}>
                    {c.passed ? '✓' : '○'} {c.detail}
                  </p>
                ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">Generated {new Date(report.generatedAt).toLocaleString()}</p>
        </>
      )}
    </Card>
  );
}
