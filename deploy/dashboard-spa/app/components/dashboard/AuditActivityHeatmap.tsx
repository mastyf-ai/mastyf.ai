'use client';

import { Fragment } from 'react';
import type { AuditActivityMatrix } from '@/lib/guardian-api';

type Props = {
  activity?: AuditActivityMatrix | null;
};

function cellOpacity(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return 0.15 + (count / max) * 0.85;
}

export function AuditActivityHeatmap({ activity }: Props) {
  if (!activity?.days?.length) {
    return <p className="muted">No activity in selected window.</p>;
  }

  const { days, hours, matrix, maxCount } = activity;

  return (
    <div className="audit-activity-heatmap-wrap">
      <div className="audit-activity-heatmap" role="img" aria-label="Audit activity by day and hour">
        <div className="audit-heatmap-day-label" />
        {hours.map((h) => (
          <div key={`h-${h}`} className="audit-heatmap-hour-label">
            {h % 6 === 0 ? h : ''}
          </div>
        ))}
        {days.map((day, di) => (
          <Fragment key={day}>
            <div className="audit-heatmap-day-label">{day.slice(5)}</div>
            {hours.map((hour, hi) => {
              const count = matrix[di]?.[hi] ?? 0;
              return (
                <div
                  key={`${day}-${hour}`}
                  className={`audit-heatmap-cell ${count > 0 ? 'active' : ''}`}
                  data-count={count}
                  title={`${day} ${hour}:00 UTC — ${count} event(s)`}
                  style={{
                    background:
                      count > 0
                        ? `rgba(56, 189, 248, ${cellOpacity(count, maxCount)})`
                        : undefined,
                  }}
                >
                  {count > 0 ? <span className="audit-heatmap-hit" /> : null}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
      <div className="audit-heatmap-legend">
        <span className="muted">Low</span>
        <div className="audit-heatmap-legend-bar" aria-hidden />
        <span className="muted">High</span>
      </div>
    </div>
  );
}
