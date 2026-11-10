'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { SHIELD_PLATFORM_ORDER, SHIELD_PLATFORMS, shieldPlatformAvailable, type ShieldPlatform } from '@/lib/billing/shield-builds';

/** Lets an invited person download Shield with their email and code. Checking does not use the code up. */
export function JoinDownload({ initialEmail }: { initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [started, setStarted] = useState(false);
  const platforms = SHIELD_PLATFORM_ORDER.filter(shieldPlatformAvailable);

  async function download(id: ShieldPlatform) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/v1/download/shield', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, os: id, arch: SHIELD_PLATFORMS[id].primary.arch }),
      });
      const data = (await res.json().catch(() => ({}))) as { downloadUrl?: string; error?: string };
      if (!res.ok || !data.downloadUrl) {
        setError(
          res.status === 402
            ? 'That email and code do not match an invitation. Check them, or ask your team lead to send a new code.'
            : data.error || 'The download could not start. Try again shortly.',
        );
        return;
      }
      setStarted(true);
      window.location.href = data.downloadUrl;
    } catch {
      setError('Could not reach Mastyf. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section section--flush-top" aria-label="Download Shield">
      <div className="panel join-panel">
        <div className="panel__body dstack">
          <label className="field">
            <span>Email address</span>
            <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>Join code</span>
            <input
              className="input"
              value={code}
              placeholder="ABCD-2345"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <div className="dl__buttons">
            {platforms.map((id) => (
              <button
                key={id}
                type="button"
                className="btn btn-primary"
                disabled={busy || !email.trim() || !code.trim()}
                aria-busy={busy}
                onClick={() => void download(id)}
              >
                <Download size={14} strokeWidth={2} aria-hidden="true" />
                Download Shield for {SHIELD_PLATFORMS[id].name}
              </button>
            ))}
          </div>
          {error ? (
            <p className="notice notice--error" role="alert">
              {error}
            </p>
          ) : null}
          {started ? (
            <p className="notice notice--ok" role="status">
              Your download has started. Install Shield, open it, choose <strong>Join a team</strong>, and enter this same
              email and code.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
