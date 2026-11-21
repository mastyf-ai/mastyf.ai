import '../score.css';

export default function CertifiedPackageLoading() {
  return (
    <main className="score-page pkg" aria-busy="true">
      <section className="pkg-hero">
        <div className="pkg-hero__body">
          <div className="skeleton-line skeleton-title" />
          <div className="skeleton-line skeleton-meta" />
          <p className="pkg-hero__summary">Checking this package…</p>
        </div>
        <div className="pkg-hero__score">
          <div className="pkg-ring" style={{ width: 200, height: 200 }}>
            <svg width={200} height={200} viewBox="0 0 200 200" aria-hidden="true">
              <circle className="pkg-ring__track" cx={100} cy={100} r={93} fill="none" strokeWidth={6} />
            </svg>
          </div>
        </div>
      </section>
    </main>
  );
}
