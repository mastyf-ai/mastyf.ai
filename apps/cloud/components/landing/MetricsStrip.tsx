import { HERO_STATS } from './stats';

export function MetricsStrip() {
  return (
    <section className="lp-metrics" aria-label="At a glance">
      <div className="lp-metrics-inner">
        {HERO_STATS.map((s) => (
          <div key={s.label} className="lp-metric">
            <div className="lp-metric-value">{s.value}</div>
            <div className="lp-metric-label">{s.label}</div>
            <div className="lp-metric-detail">{s.detail}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
