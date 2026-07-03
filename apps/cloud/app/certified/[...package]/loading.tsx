export default function CertifiedPackageLoading() {
  return (
    <main className="score-page">
      <div className="score-breadcrumb">
        <span>Home</span>
        <span>/</span>
        <span>Security scores</span>
        <span>/</span>
        <span className="score-breadcrumb-current">Loading…</span>
      </div>

      <section className="score-hero card-elevated">
        <div className="score-hero-grid">
          <div className="score-ring-skeleton" aria-hidden />
          <div style={{ flex: 1, width: '100%' }}>
            <div className="skeleton-line skeleton-title" />
            <div className="skeleton-line skeleton-meta" />
            <div className="skeleton-line skeleton-badge" />
            <p className="score-section-lead" style={{ marginTop: '1rem' }}>
              Analyzing package security…
            </p>
          </div>
        </div>
        <div className="score-stat-row">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="score-stat-card">
              <div className="skeleton-line" style={{ width: '60%', height: '0.7rem' }} />
              <div className="skeleton-line" style={{ width: '80%', marginTop: '0.5rem' }} />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
