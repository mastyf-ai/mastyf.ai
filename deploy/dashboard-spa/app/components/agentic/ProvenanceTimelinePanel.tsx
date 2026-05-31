'use client';

import { useEffect, useState } from 'react';
import { Card } from '../ui/Card';

type ProvenanceEvent = {
  eventId: string;
  actor: string;
  eventType: string;
  resourcePath: string;
  entryHash: string;
  createdAt: string;
};

type SignedBundle = {
  bundleGzipBase64: string;
  bundleSha256: string;
  signature: string;
  merkleRoot: string;
  eventCount: number;
};

export function ProvenanceTimelinePanel() {
  const [events, setEvents] = useState<ProvenanceEvent[]>([]);
  const [merkleRoot, setMerkleRoot] = useState<string | null>(null);
  const [verifyOk, setVerifyOk] = useState<boolean | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/provenance/timeline')
      .then((r) => r.json())
      .then((d: { events: ProvenanceEvent[]; merkleRoot: string | null }) => {
        setEvents(d.events ?? []);
        setMerkleRoot(d.merkleRoot ?? null);
      })
      .catch(() => {});
  }, []);

  async function verify() {
    const res = await fetch('/api/provenance/verify', { method: 'POST' });
    const data = await res.json() as { valid: boolean };
    setVerifyOk(data.valid);
  }

  async function downloadSignedBundle(format: 'signed' | 'tarball' = 'signed') {
    const res = await fetch(`/api/provenance/export?format=${format}`);
    if (format === 'tarball') {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'provenance-bundle.tar.gz';
      a.click();
      URL.revokeObjectURL(url);
      setExportMsg('Downloaded signed tarball for auditors');
      return;
    }
    const bundle = await res.json() as SignedBundle;
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `provenance-signed-${bundle.merkleRoot.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExportMsg(`Exported ${bundle.eventCount} events (SHA256 ${bundle.bundleSha256.slice(0, 12)}…)`);
  }

  return (
    <Card className="p-4 space-y-3">
      <h3 className="font-semibold">Config Provenance Chain (C1)</h3>
      <p className="text-sm font-mono truncate">Merkle root: {merkleRoot ?? '—'}</p>
      <div className="flex gap-3 text-sm">
        <button type="button" className="underline" onClick={() => void verify()}>
          Verify chain
        </button>
        <button type="button" className="underline" onClick={() => void downloadSignedBundle('signed')}>
          Download signed bundle (SIEM)
        </button>
        <button type="button" className="underline" onClick={() => void downloadSignedBundle('tarball')}>
          Download signed tarball
        </button>
      </div>
      {verifyOk != null && (
        <p className="text-sm">{verifyOk ? 'Chain valid' : 'Chain invalid'}</p>
      )}
      {exportMsg && <p className="text-sm text-muted-foreground">{exportMsg}</p>}
      <ul className="text-sm space-y-1 max-h-48 overflow-y-auto">
        {events.map((e) => (
          <li key={e.eventId}>
            {e.createdAt} · {e.eventType} · {e.actor} · {e.resourcePath}
          </li>
        ))}
        {!events.length && <li className="text-muted-foreground">No provenance events yet.</li>}
      </ul>
    </Card>
  );
}
