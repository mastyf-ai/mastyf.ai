'use client';

import { useEffect, useState } from 'react';
import { fetchSetupCloudStatus, type SetupCloudStatus } from '@/lib/mastyf-ai-api';
import { Badge } from '../ui/Badge';

/**
 * Linking this install to a mastyf.ai workspace is done with environment variables read at
 * start-up (src/license/license-client.ts, src/control-plane/*). This shows the real state and the
 * real steps; it does not pretend to connect from a form. Same variables as mastyf.ai/docs/connect.
 */
const CLOUD_ENV = `MASTYF_AI_CONTROL_PLANE_URL=https://www.mastyf.ai
MASTYF_AI_MULTI_TENANT_ENABLED=true
MASTYF_AI_TENANT_ID=<your workspace ID>
MASTYF_AI_CLOUD_API_KEY=<API key from Settings, API key>
DASHBOARD_JWT_SECRET=<random, this host only: openssl rand -base64 32>`;

export function CloudConnectionInfo({ initial }: { initial?: SetupCloudStatus | null }) {
  const [status, setStatus] = useState<SetupCloudStatus | null>(initial ?? null);
  const [loaded, setLoaded] = useState(initial !== undefined);

  useEffect(() => {
    if (initial !== undefined) {
      setStatus(initial);
      setLoaded(true);
      return;
    }
    void fetchSetupCloudStatus().then((s) => {
      setStatus(s);
      setLoaded(true);
    });
  }, [initial]);

  if (!loaded) return <p className="text-sm text-muted">Checking the cloud link</p>;

  if (status?.connected) {
    return (
      <div style={{ display: 'grid', gap: 8 }}>
        <p className="text-sm">
          <Badge variant="success" dot>Linked</Badge>{' '}
          {status.controlPlaneUrl ? <>to <code>{status.controlPlaneUrl}</code></> : null}
        </p>
        <p className="text-sm text-muted">
          Policy, block events and receipts sync with your mastyf.ai workspace. To unlink, remove{' '}
          <code>MASTYF_AI_CONTROL_PLANE_URL</code> and <code>MASTYF_AI_CLOUD_API_KEY</code> from the environment and restart Mastyf.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <p className="text-sm">
        <Badge variant="neutral" dot>Not linked</Badge> This install runs on its own. Linking it to a mastyf.ai workspace
        adds fleet-wide policy, the hosted dashboard and SSO.
      </p>
      <ol className="text-sm" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
        <li>
          Sign in at{' '}
          <a href="https://www.mastyf.ai/dashboard/settings" target="_blank" rel="noopener noreferrer">mastyf.ai</a> and copy your
          workspace ID and API key from Settings.
        </li>
        <li>Set these before starting Mastyf, for example in a <code>.env</code> file next to it:</li>
      </ol>
      <pre className="code-block" style={{ background: 'var(--bg-muted)', padding: 10, borderRadius: 8, fontSize: 12, overflow: 'auto', margin: 0 }}>
        {CLOUD_ENV}
      </pre>
      <p className="text-sm text-muted" style={{ margin: 0 }}>
        3. Restart with <code>pnpm dashboard:proxy</code>. This card then shows the link.{' '}
        <a href="https://www.mastyf.ai/docs/connect" target="_blank" rel="noopener noreferrer">Full guide</a>
      </p>
    </div>
  );
}
