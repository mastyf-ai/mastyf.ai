'use client';

import type { ReactNode } from 'react';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'live' | 'degraded' | 'offline';

interface BadgeProps {
  variant?: BadgeVariant;
  tone?: BadgeVariant | 'warn';
  children: ReactNode;
  dot?: boolean;
  className?: string;
}

function normalizeVariant(variant?: BadgeVariant, tone?: BadgeVariant | 'warn'): BadgeVariant {
  if (variant) return variant;
  if (tone === 'warn') return 'warning';
  return (tone as BadgeVariant) || 'neutral';
}

const variantClass: Record<BadgeVariant, string> = {
  success: 'badge-success',
  warning: 'badge-warning',
  danger: 'badge-danger',
  info: 'badge-info',
  neutral: 'badge-neutral',
  live: 'badge-live',
  degraded: 'badge-degraded',
  offline: 'badge-offline',
};

export function Badge({ variant, tone, children, dot, className = '' }: BadgeProps) {
  const v = normalizeVariant(variant, tone);
  return (
    <span className={`badge ${variantClass[v]} ${className}`}>
      {dot && <span className={`badge-dot ${v}`} />}
      {children}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const v: BadgeVariant =
    severity === 'CRITICAL' || severity === 'HIGH' ? 'danger'
    : severity === 'MEDIUM' ? 'warning'
    : severity === 'LOW' ? 'neutral'
    : 'info';

  return (
    <span className={`severity-label severity-${severity.toLowerCase()}`}>
      <span className="severity-dot" />
      {severity}
    </span>
  );
}
