'use client';

import { useState } from 'react';
import { Card } from '../ui/Card';

type InsuranceReport = {
  id: string;
  serverName: string;
  aleUsd: number;
  blastRadiusUsd: number;
  exploitProbability: number;
  exposureScore: number;
  riskTier: string;
  underwriterSummary: string;
  generatedAt: string;
};

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

export function InsurancePanel() {
  const [serverName, setServerName] = useState('filesystem');
  const [toolCount, setToolCount] = useState(20);
  const [recordsAtRisk, setRecordsAtRisk] = useState(5000);
  const [networkExposure, setNetworkExposure] = useState(0.7);
  const [report, setReport] = useState<InsuranceReport | null>(null);
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function quantify() {
    setLoading(true);
    setError(null);
    try {
      const result = await postJson<InsuranceReport>('/api/agentic/insurance/quantify', {
        serverName,
        toolCount,
        recordsAtRisk,
        networkExposure,
      });
      setReport(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function exportPdf() {
    setLoading(true);
    setError(null);
    try {
      const result = await postJson<{ report: InsuranceReport; path: string; pdfBase64: string }>(
        '/api/agentic/insurance/export-pdf',
        { serverName, toolCount, recordsAtRisk, networkExposure },
      );
      setReport(result.report);
      setPdfPath(result.path);
      const blob = new Blob([Uint8Array.from(atob(result.pdfBase64), c => c.charCodeAt(0))], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `insurance-${serverName}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-4 space-y-3">
      <h3 className="font-semibold">Cyber Insurance Risk Report (C4)</h3>
      <p className="text-sm text-muted-foreground">
        CFO / underwriter view — ALE quantification with PDF export for cyber insurance workflows.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
        <label className="flex flex-col gap-1">
          Server
          <input className="border rounded px-2 py-1" value={serverName} onChange={(e) => setServerName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          Tool count
          <input type="number" className="border rounded px-2 py-1" value={toolCount} onChange={(e) => setToolCount(Number(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1">
          Records at risk
          <input type="number" className="border rounded px-2 py-1" value={recordsAtRisk} onChange={(e) => setRecordsAtRisk(Number(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1">
          Network exposure (0–1)
          <input type="number" step="0.1" className="border rounded px-2 py-1" value={networkExposure} onChange={(e) => setNetworkExposure(Number(e.target.value))} />
        </label>
      </div>
      <div className="flex gap-2">
        <button type="button" className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm disabled:opacity-50" disabled={loading} onClick={() => void quantify()}>
          Quantify risk
        </button>
        <button type="button" className="px-3 py-1.5 rounded border text-sm disabled:opacity-50" disabled={loading} onClick={() => void exportPdf()}>
          Export underwriter PDF
        </button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {report && (
        <div className="text-sm space-y-1 border-t border-border pt-2">
          <p><span className="font-medium">Risk tier:</span> {report.riskTier.toUpperCase()}</p>
          <p><span className="font-medium">ALE:</span> ${report.aleUsd.toLocaleString()}</p>
          <p><span className="font-medium">Blast radius:</span> ${Math.round(report.blastRadiusUsd).toLocaleString()}</p>
          <p><span className="font-medium">Exploit probability:</span> {(report.exploitProbability * 100).toFixed(1)}%</p>
          <p className="text-muted-foreground">{report.underwriterSummary}</p>
          {pdfPath && <p className="text-xs font-mono">Saved: {pdfPath}</p>}
        </div>
      )}
    </Card>
  );
}
