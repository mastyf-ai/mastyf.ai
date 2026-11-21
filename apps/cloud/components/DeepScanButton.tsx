'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Props = {
  packageName: string;
  enabled: boolean;
  currentTier: 'static' | 'live';
  source: 'computed' | 'attested';
};

type JobPoll = {
  jobId?: string;
  status?: string;
  pollUrl?: string;
  error?: string;
  message?: string;
};

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function DeepScanButton({ packageName, enabled, currentTier, source }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  if (currentTier === 'live' && source === 'computed') return null;

  async function pollJob(pollUrl: string, maxAttempts = 40) {
    for (let i = 0; i < maxAttempts; i++) {
      const res = await fetch(pollUrl);
      const body = (await res.json()) as JobPoll & { result?: { ok?: boolean } };
      if (!res.ok) {
        throw new Error(body.error || `Poll failed (${res.status})`);
      }
      setStatus(body.status ?? 'pending');
      if (body.status === 'done') return;
      if (body.status === 'failed') {
        throw new Error(body.error || 'Deep scan failed');
      }
      await sleep(3000);
    }
    throw new Error('Deep scan timed out — check back later');
  }

  async function runDeepScan() {
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(
        `/api/v1/deep-scan/${encodeURIComponent(packageName)}`,
        { method: 'POST' },
      );
      const body = (await res.json()) as JobPoll & { ok?: boolean };
      if (res.status === 202 && body.pollUrl) {
        setStatus('queued');
        await pollJob(body.pollUrl);
        router.refresh();
        return;
      }
      if (!res.ok) {
        setError(body.message || body.error || `Deep scan failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Deep scan failed');
    } finally {
      setLoading(false);
      setStatus(null);
    }
  }

  return (
    <div className="pkg-scan">
      <button
        type="button"
        className="btn btn-glass"
        onClick={() => void runDeepScan()}
        disabled={!enabled || loading}
        title={enabled ? 'Starts the server and sends test attacks to it. Takes up to a minute.' : undefined}
      >
        {loading ? (status === 'queued' ? 'Waiting for a scanner…' : 'Scanning…') : 'Run a live scan'}
      </button>
      {!enabled ? <p className="pkg-scan__note">Live scans are paused right now.</p> : null}
      {error ? (
        <p role="alert" className="pkg-scan__note pkg-scan__note--error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
