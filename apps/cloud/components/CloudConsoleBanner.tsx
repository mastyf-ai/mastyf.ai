import Link from 'next/link';
import { CLOUD_NAME, SITE_NAME } from '@/lib/product-links';

/** Clarifies that /dashboard is the mastyf.ai cloud console. */
export function CloudConsoleBanner() {
  return (
    <div className="card" style={{ marginBottom: '1.5rem', borderColor: 'var(--accent, #3b82f6)' }}>
      <h2 style={{ marginTop: 0 }}>{CLOUD_NAME}</h2>
      <p className="muted" style={{ marginBottom: '0.75rem' }}>
        You are signed in to <strong>{SITE_NAME}</strong>. Edit policy, copy your tenant snippet, and
        manage API keys here — all in the browser, no install required.
      </p>
      <p className="muted" style={{ marginBottom: 0, fontSize: '0.9rem' }}>
        Optional: link a self-hosted proxy to sync policy via API.{' '}
        <Link href="/dashboard/connect">Connect proxy →</Link>
      </p>
    </div>
  );
}
