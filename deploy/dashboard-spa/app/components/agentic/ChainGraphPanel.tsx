'use client';

import { useEffect, useState } from 'react';
import { Card } from '../ui/Card';
import { fetchFleetChainGraph, type ChainGraph } from '@/lib/guardian-api';

const NODE_COLORS: Record<string, string> = {
  agent: '#6366f1',
  server: '#0ea5e9',
  tool: '#64748b',
};

type Props = { refreshKey?: number };

export function ChainGraphPanel({ refreshKey = 0 }: Props) {
  const [graph, setGraph] = useState<ChainGraph | null>(null);

  useEffect(() => {
    void fetchFleetChainGraph().then(setGraph);
  }, [refreshKey]);

  const width = 480;
  const height = 220;
  const positions = new Map<string, { x: number; y: number }>();
  if (graph) {
    const agents = graph.nodes.filter((n) => n.type === 'agent');
    const servers = graph.nodes.filter((n) => n.type === 'server');
    const tools = graph.nodes.filter((n) => n.type === 'tool');
    agents.forEach((n, i) => positions.set(n.id, { x: 60, y: 40 + i * 50 }));
    servers.forEach((n, i) => positions.set(n.id, { x: width / 2, y: 30 + i * 45 }));
    tools.forEach((n, i) => positions.set(n.id, { x: width - 70, y: 25 + i * 35 }));
  }

  return (
    <Card className="p-4 space-y-3">
      <h3 className="font-semibold">Cross-MCP Attack Chain Graph (A1)</h3>
      {!graph?.nodes.length ? (
        <p className="text-sm text-muted-foreground">No cross-server chain events recorded yet.</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-h-56 bg-muted/30 rounded">
            {graph.edges.map((e, i) => {
              const from = positions.get(e.from);
              const to = positions.get(e.to);
              if (!from || !to) return null;
              return (
                <line
                  key={`${e.from}-${e.to}-${i}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={e.blocked ? '#ef4444' : '#94a3b8'}
                  strokeWidth={1.5}
                />
              );
            })}
            {graph.nodes.slice(0, 24).map((n) => {
              const p = positions.get(n.id);
              if (!p) return null;
              return (
                <g key={n.id}>
                  <circle cx={p.x} cy={p.y} r={8} fill={NODE_COLORS[n.type] ?? '#64748b'} />
                  <text x={p.x + 12} y={p.y + 4} fontSize={9} fill="currentColor">
                    {n.label.slice(0, 14)}
                  </text>
                </g>
              );
            })}
          </svg>
          {(graph.alerts ?? []).slice(0, 3).map((a) => (
            <p key={a.alertId} className="text-xs text-amber-700 dark:text-amber-400">
              {a.pattern} ({(a.confidence * 100).toFixed(0)}%): {a.description}
            </p>
          ))}
        </>
      )}
    </Card>
  );
}
