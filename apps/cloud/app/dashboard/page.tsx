import { CloudConsoleBanner } from '@/components/CloudConsoleBanner';
import { auth } from '@/lib/auth';
import { getUserOrg } from '@/lib/org-context';
import { CLOUD_NAME, SITE_NAME } from '@/lib/product-links';
import Link from 'next/link';

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? 'http://localhost:3001').replace(
    /\/$/,
    '',
  );
}

export default async function DashboardPage() {
  const session = await auth();
  const ctx = await getUserOrg(session!.user!.id);
  if (!ctx) return null;

  const envBlock = `# ${SITE_NAME} Cloud — your tenant
MASTYF_AI_TENANT_ID=${ctx.org.slug}
MASTYF_AI_CONTROL_PLANE_URL=${appUrl()}
# Create or rotate in Settings → API keys:
MASTYF_AI_CLOUD_API_KEY=<your-api-key>

# Pull policy from ${SITE_NAME} Cloud:
# curl -H "Authorization: Bearer <api-key>" ${appUrl()}/api/v1/policy
`;

  return (
    <main className="container">
      <CloudConsoleBanner />

      <h1>{ctx.org.name}</h1>
      <p className="muted">
        {CLOUD_NAME} tenant · ID <code>{ctx.org.slug}</code>
      </p>

      <div className="card">
        <h2>Your {SITE_NAME} setup</h2>
        <p className="muted">
          This console is {SITE_NAME} — manage policy, API keys, and fleet settings here. No local
          install required. Copy your tenant details below for API automation and badge embeds.
        </p>
        <pre className="env-block">{envBlock}</pre>
        <div className="actions">
          <Link href="/dashboard/policy" className="btn btn-primary">
            Edit policy
          </Link>
          <Link href="/dashboard/settings" className="btn">
            API keys
          </Link>
          <Link href="/certified" className="btn">
            Security scores
          </Link>
        </div>
      </div>

      <div className="card" style={{ marginTop: '1.25rem' }}>
        <h2>Quick links</h2>
        <ul className="pro-features" style={{ marginBottom: 0 }}>
          <li>
            <Link href="/certified">Look up MCP package scores</Link> — public 0–100 trust badges
          </li>
          <li>
            <Link href="/dashboard/policy">Policy YAML</Link> — edit and download tenant policy
          </li>
          <li>
            <Link href="/dashboard/fleet">Fleet</Link> — see linked self-hosted instances (if any)
          </li>
        </ul>
      </div>

      <div className="card" style={{ marginTop: '1.25rem', borderColor: 'rgba(34, 197, 94, 0.25)' }}>
        <h2>Optional: connect self-hosted proxy</h2>
        <p className="muted">
          Running a self-hosted MCP security proxy? Connect it to this {SITE_NAME} tenant to sync
          policy via API and enable fleet visibility. You do not need this for scores, badges, or
          cloud policy editing.
        </p>
        <Link href="/dashboard/connect" className="btn">
          Connect self-hosted proxy →
        </Link>
      </div>
    </main>
  );
}
