'use client';

import type { ReactNode } from 'react';

type Accent = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface KpiCardProps {
  label: string;
  value: string | number;
  accent?: Accent;
  delta?: { value: string; direction: 'up' | 'down' | 'flat' };
  secondary?: string;
  children?: ReactNode;
  className?: string;
}

export function KpiCard({ label, value, accent, delta, secondary, children, className = '' }: KpiCardProps) {
  return (
    <div className={`kpi${accent ? ` accent-${accent}` : ''} ${className}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {delta && (
        <span className={`kpi-delta ${delta.direction}`}>
          {delta.direction === 'up' ? '↑' : delta.direction === 'down' ? '↓' : '→'} {delta.value}
        </span>
      )}
      {secondary && <div className="kpi-secondary">{secondary}</div>}
      {children}
    </div>
  );
}
