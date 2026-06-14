'use client';

import type { ReactNode, CSSProperties } from 'react';

type Props = {
  title?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  variant?: 'default' | 'elevated';
  bodyPadding?: boolean;
};

export function Card({ title, subtitle, actions, children, className = '', style, variant = 'default', bodyPadding = true }: Props) {
  return (
    <section className={`card${variant === 'elevated' ? ' card-elevated' : ''} ${className}`.trim()} style={style}>
      {title ? (
        <div className="card-header">
          <div>
            <h3 className="card-title">{title}</h3>
            {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      <div className={bodyPadding ? 'card-body' : 'card-body-no-padding'}>{children}</div>
    </section>
  );
}
