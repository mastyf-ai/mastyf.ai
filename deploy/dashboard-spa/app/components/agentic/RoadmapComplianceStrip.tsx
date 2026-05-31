'use client';

import { useEffect, useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { fetchPlanComplianceAudit, type PlanComplianceReport } from '@/lib/guardian-api';

type Props = {
  refreshKey?: number;
  onOpenAgentic?: () => void;
};

export function RoadmapComplianceStrip({ refreshKey = 0, onOpenAgentic }: Props) {
  const [report, setReport] = useState<PlanComplianceReport | null>(null);

  useEffect(() => {
    void fetchPlanComplianceAudit().then(setReport);
  }, [refreshKey]);

  if (!report) return null;

  const below = report.modules.filter((m) => m.score < 80);

  return (
    <Card className="p-4 border border-indigo-200 dark:border-indigo-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm">Industry roadmap compliance</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {report.summary}
            {below.length > 0 ? ` · Below threshold: ${below.map((m) => m.id).join(', ')}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold">{report.overallScore}%</span>
          {onOpenAgentic ? (
            <Button variant="secondary" size="sm" onClick={onOpenAgentic}>
              Open Agentic AI
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
