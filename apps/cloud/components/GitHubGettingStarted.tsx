import { GITHUB_README_URL, GITHUB_REPO_URL } from '@/lib/github-links';
import { SITE_NAME } from '@/lib/product-links';

export function GitHubGettingStarted() {
  return (
    <div className="card">
      <h2>Get started on GitHub</h2>
      <p className="muted">
        {SITE_NAME} is open source on GitHub. Browse the source, report issues, or contribute to the
        detection engine.
      </p>
      <div className="actions" style={{ marginTop: '1rem' }}>
        <a href={GITHUB_REPO_URL} className="btn btn-primary" rel="noopener noreferrer">
          Open {SITE_NAME} on GitHub
        </a>
        <a href={GITHUB_README_URL} className="btn" rel="noopener noreferrer">
          Installation guide (README)
        </a>
      </div>
    </div>
  );
}
