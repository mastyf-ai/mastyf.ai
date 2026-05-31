'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '../ui/Card';

type ThreatRow = {
  toolName: string;
  serverName: string;
  stride: Record<string, string>;
  linddun: Record<string, string>;
  mitigations: string[];
};

type DfdNode = { id: string; type: string; label: string };
type DfdEdge = { from: string; to: string; label: string };

type ThreatReport = {
  title: string;
  summary: string;
  toolThreats: ThreatRow[];
  nodes: DfdNode[];
  edges: DfdEdge[];
};

function layoutDfd(nodes: DfdNode[], edges: DfdEdge[]) {
  const typeCol: Record<string, number> = {
    client: 40,
    proxy: 180,
    server: 320,
    tool: 460,
    datastore: 600,
  };
  const byCol = new Map<number, DfdNode[]>();
  for (const n of nodes) {
    const col = typeCol[n.type] ?? 320;
    if (!byCol.has(col)) byCol.set(col, []);
    byCol.get(col)!.push(n);
  }
  const positions = new Map<string, { x: number; y: number }>();
  for (const [col, colNodes] of byCol) {
    colNodes.forEach((n, i) => {
      positions.set(n.id, { x: col, y: 30 + i * 56 });
    });
  }
  return { positions, width: 720, height: Math.max(200, nodes.length * 20 + 80), edges };
}

function DfdGraph({ nodes, edges }: { nodes: DfdNode[]; edges: DfdEdge[] }) {
  const layout = useMemo(() => layoutDfd(nodes, edges), [nodes, edges]);
  if (!nodes.length) return null;

  return (
    <svg
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      className="w-full border border-border rounded bg-muted/30"
      role="img"
      aria-label="Data flow diagram"
    >
      {layout.edges.map((e) => {
        const from = layout.positions.get(e.from);
        const to = layout.positions.get(e.to);
        if (!from || !to) return null;
        return (
          <g key={`${e.from}-${e.to}-${e.label}`}>
            <line
              x1={from.x + 90}
              y1={from.y + 16}
              x2={to.x}
              y2={to.y + 16}
              stroke="currentColor"
              strokeOpacity={0.35}
              markerEnd="url(#arrow)"
            />
            <text
              x={(from.x + to.x) / 2 + 45}
              y={(from.y + to.y) / 2 + 10}
              fontSize={9}
              fill="currentColor"
              opacity={0.6}
            >
              {e.label}
            </text>
          </g>
        );
      })}
      <defs>
        <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" fillOpacity={0.5} />
        </marker>
      </defs>
      {nodes.map((n) => {
        const p = layout.positions.get(n.id);
        if (!p) return null;
        return (
          <g key={n.id}>
            <rect
              x={p.x}
              y={p.y}
              width={90}
              height={32}
              rx={4}
              fill="var(--background, #fff)"
              stroke="currentColor"
              strokeOpacity={0.4}
            />
            <text x={p.x + 6} y={p.y + 14} fontSize={8} fill="currentColor" opacity={0.55}>
              {n.type}
            </text>
            <text x={p.x + 6} y={p.y + 26} fontSize={10} fill="currentColor">
              {n.label.length > 12 ? `${n.label.slice(0, 11)}…` : n.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function ThreatModelPanel() {
  const [report, setReport] = useState<ThreatReport | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    try {
      const res = await fetch('/api/threat-model/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configPath: 'scenarios/real-life/proxy-filesystem-config.json',
          activePolicies: ['deny-curl', 'require-certification'],
          format: 'markdown',
        }),
      });
      const data = await res.json() as { markdown?: string; report: ThreatReport };
      setReport(data.report);
      setMarkdown(data.markdown ?? null);
    } catch {
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void generate();
  }, []);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Threat Model as Code (C2)</h3>
        <button type="button" className="text-sm underline" disabled={loading} onClick={() => void generate()}>
          Regenerate
        </button>
      </div>
      {report ? (
        <>
          <p className="text-sm text-muted-foreground">{report.summary}</p>
          {report.nodes.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium">Data Flow Diagram</p>
              <DfdGraph nodes={report.nodes} edges={report.edges ?? []} />
            </div>
          )}
          <div className="text-xs max-h-48 overflow-y-auto space-y-2">
            {report.toolThreats.slice(0, 8).map((row) => (
              <div key={`${row.serverName}-${row.toolName}`} className="border-b border-border pb-2">
                <p className="font-medium">{row.serverName} / {row.toolName}</p>
                {Object.entries(row.stride).slice(0, 2).map(([k, v]) => (
                  <p key={k} className="text-muted-foreground">STRIDE {k}: {v}</p>
                ))}
                <p className="text-green-700 dark:text-green-400">{row.mitigations[0]}</p>
              </div>
            ))}
          </div>
          {markdown && (
            <details className="text-xs">
              <summary className="cursor-pointer">View THREATS.md preview</summary>
              <pre className="mt-2 p-2 bg-muted overflow-x-auto max-h-40">{markdown.slice(0, 2000)}</pre>
            </details>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{loading ? 'Generating…' : 'No threat model yet.'}</p>
      )}
    </Card>
  );
}
