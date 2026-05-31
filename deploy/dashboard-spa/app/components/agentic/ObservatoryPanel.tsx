'use client';

import { useEffect, useState } from 'react';
import { Card } from '../ui/Card';

type ObservatorySnapshot = {
  adoptionScore: number;
  threatHeatIndex: number;
  avgBlockRate: number;
  serverCount: number;
  topThreatClasses: Array<{ cls: string; count: number }>;
  generatedAt: string;
  trends?: { blockRateDelta: number; serverCountDelta: number; threatHeatDelta: number };
};

export function ObservatoryPanel() {
  const [snap, setSnap] = useState<ObservatorySnapshot | null>(null);
  const [alerts, setAlerts] = useState<Array<{ alertType: string; message: string; severity?: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  async function loadSnapshot(cloud = false) {
    setLoading(true);
    try {
      const url = cloud ? '/api/agentic/observatory/snapshot?cloud=true' : '/api/agentic/observatory/snapshot';
      const d = await fetch(url).then(r => r.json()) as ObservatorySnapshot;
      setSnap(d);
    } catch {
      setSnap(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadAlerts() {
    try {
      const d = (await fetch('/api/agentic/observatory/alerts?evaluate=true').then((r) => r.json())) as {
        alerts: Array<{ alertType: string; message: string; severity?: string }>;
      };
      setAlerts(d.alerts ?? []);
    } catch {
      setAlerts([]);
    }
  }

  async function syncCloudAndMesh() {
    setLoading(true);
    setSyncMsg(null);
    try {
      const cloud = await fetch('/api/agentic/observatory/ingest-cloud', { method: 'POST' }).then((r) => r.json()) as {
        ingested?: number;
        cloudAvailable?: boolean;
      };
      const mesh = (await fetch('/api/agentic/observatory/sync-mesh', { method: 'POST' }).then((r) => r.json())) as {
        pulled?: number;
        published?: boolean;
      };
      setSyncMsg(
        `Cloud: ${cloud.ingested ?? 0} metrics${cloud.cloudAvailable ? '' : ' (relay offline)'} · Mesh: ${mesh.pulled ?? 0} pulled`,
      );
      await Promise.all([loadSnapshot(true), loadAlerts()]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSnapshot(false);
    void loadAlerts();
  }, []);

  return (
    <Card className="p-4 space-y-3">
      <h3 className="font-semibold">Ecosystem Observatory (B2)</h3>
      <div className="flex gap-2">
        <button type="button" className="px-2 py-1 text-xs border rounded disabled:opacity-50" disabled={loading} onClick={() => void loadSnapshot(false)}>Refresh</button>
        <button type="button" className="px-2 py-1 text-xs border rounded disabled:opacity-50" disabled={loading} onClick={() => void syncCloudAndMesh()}>Sync cloud + mesh</button>
      </div>
      {syncMsg && <p className="text-xs text-muted-foreground">{syncMsg}</p>}
      {alerts.length > 0 && (
        <ul className="text-xs space-y-1 border border-amber-200 dark:border-amber-800 rounded p-2 bg-amber-50/50 dark:bg-amber-950/20">
          {alerts.slice(0, 5).map((a, i) => (
            <li key={`${a.alertType}-${i}`} className="text-amber-800 dark:text-amber-300">
              [{a.alertType}] {a.message}
            </li>
          ))}
        </ul>
      )}
      {snap ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-muted-foreground">Adoption</p>
            <p className="text-xl font-bold">{snap.adoptionScore}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Threat heat</p>
            <p className="text-xl font-bold">{snap.threatHeatIndex}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Avg block rate</p>
            <p className="text-xl font-bold">{(snap.avgBlockRate * 100).toFixed(0)}%</p>
          </div>
          <div>
            <p className="text-muted-foreground">Servers</p>
            <p className="text-xl font-bold">{snap.serverCount}</p>
          </div>
          <div className="col-span-full">
            <p className="text-muted-foreground mb-1">Top threat classes</p>
            <ul className="text-xs space-y-0.5">
              {snap.topThreatClasses.slice(0, 5).map((t) => (
                <li key={t.cls}>{t.cls}: {t.count}</li>
              ))}
            </ul>
          </div>
          {snap.trends && (
            <div className="col-span-full text-xs text-muted-foreground">
              Trends — block rate Δ{(snap.trends.blockRateDelta * 100).toFixed(1)}%, servers Δ{snap.trends.serverCountDelta}, heat Δ{snap.trends.threatHeatDelta.toFixed(0)}
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Loading observatory snapshot…</p>
      )}
    </Card>
  );
}
