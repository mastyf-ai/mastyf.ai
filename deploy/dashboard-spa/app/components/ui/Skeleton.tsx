type TextProps = {
  lines?: number;
  width?: string | string[];
};

export function SkeletonText({ lines = 1, width }: TextProps) {
  const widths = Array.isArray(width) ? width : lines > 1 ? undefined : [width || '60%'];
  return (
    <span className="skeleton-text" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i}
          className="skeleton-line"
          style={{ width: widths?.[i] ?? `${[80, 55, 70][i % 3]}%` }}
        />
      ))}
    </span>
  );
}

type CardProps = {
  rows?: number;
  height?: number;
};

export function SkeletonCard({ rows = 3, height }: CardProps) {
  return (
    <div className="skeleton-card" aria-hidden="true" style={height ? { minHeight: height } : undefined}>
      <span className="skeleton-line" style={{ width: '40%', marginBottom: 12 }} />
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton-line" style={{ width: `${[90, 75, 85][i % 3]}%`, marginBottom: 8 }} />
      ))}
    </div>
  );
}

export function SkeletonKpi() {
  return (
    <div className="skeleton-kpi" aria-hidden="true">
      <span className="skeleton-line" style={{ width: '50%', marginBottom: 8 }} />
      <span className="skeleton-line" style={{ width: '30%', height: 28, marginBottom: 4 }} />
      <span className="skeleton-line" style={{ width: '40%' }} />
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="skeleton-row" aria-hidden="true">
      <span className="skeleton-line" style={{ width: '30%' }} />
      <span className="skeleton-line" style={{ width: '20%' }} />
      <span className="skeleton-line" style={{ width: '15%' }} />
    </div>
  );
}
