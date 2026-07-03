import Link from 'next/link';

type Props = {
  packageName: string;
};

export function PackageNotFound({ packageName }: Props) {
  return (
    <main className="score-page">
      <nav className="score-breadcrumb" aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        <span aria-hidden>/</span>
        <Link href="/certified">Security scores</Link>
        <span aria-hidden>/</span>
        <span className="score-breadcrumb-current">{packageName}</span>
      </nav>

      <section className="score-not-found card-elevated">
        <span className="score-not-found-badge">Package not found</span>
        <h1 className="score-hero-title">{packageName}</h1>
        <p className="score-section-lead">
          This package name is not published on npm, or the name is invalid. Check the spelling
          (scoped packages use <code>@scope/name</code>) and try again.
        </p>
        <Link href="/certified" className="socket-search-btn" style={{ display: 'inline-flex', marginTop: '1rem' }}>
          ← Back to lookup
        </Link>
      </section>
    </main>
  );
}
