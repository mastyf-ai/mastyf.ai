'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SITE_NAME } from '@/lib/product-links';
import {
  ARCHITECTURE_GRAPHS,
  getConnectedEdgeIds,
} from '@/lib/architecture-graph';
import { DEFENSE_FABRIC_COPY } from './stats';
import { RevealOnScroll } from './RevealOnScroll';
import { ArchitectureCanvas } from './architecture/ArchitectureCanvas';
import { ArchitectureDetailPanel } from './architecture/ArchitectureDetailPanel';

export function InteractiveArchitectureSection() {
  const [graphId, setGraphId] = useState(ARCHITECTURE_GRAPHS[0].id);
  const [selectedId, setSelectedId] = useState(ARCHITECTURE_GRAPHS[0].flowOrder[0]);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const graph = useMemo(
    () => ARCHITECTURE_GRAPHS.find((g) => g.id === graphId) ?? ARCHITECTURE_GRAPHS[0],
    [graphId],
  );

  const selectedNode = graph.nodes.find((n) => n.id === selectedId) ?? null;

  const connectedLabels = useMemo(() => {
    if (!selectedId) return [];
    const edgeIds = getConnectedEdgeIds(graph, selectedId);
    const labels: string[] = [];
    for (const edge of graph.edges) {
      const key = `${edge.from}-${edge.to}`;
      if (!edgeIds.has(key)) continue;
      const other = edge.from === selectedId ? edge.to : edge.from;
      const node = graph.nodes.find((n) => n.id === other);
      if (node) labels.push(node.label);
    }
    return labels;
  }, [graph, selectedId]);

  const switchGraph = (id: string) => {
    const next = ARCHITECTURE_GRAPHS.find((g) => g.id === id);
    if (!next) return;
    setGraphId(id);
    setSelectedId(next.flowOrder[0]);
    setHoverId(null);
    setPlaying(false);
  };

  const playFlow = useCallback(() => {
    setPlaying(true);
  }, []);

  useEffect(() => {
    if (!playing) return;
    let i = 0;
    setSelectedId(graph.flowOrder[0]);
    const timer = setInterval(() => {
      i += 1;
      if (i >= graph.flowOrder.length) {
        setPlaying(false);
        clearInterval(timer);
        return;
      }
      setSelectedId(graph.flowOrder[i]);
    }, 1200);
    return () => clearInterval(timer);
  }, [playing, graph]);

  return (
    <RevealOnScroll mode="architecture">
      <section className="lp-section lp-arch-section" id="architecture">
        <div className="lp-section-header">
          <h2>Interactive architecture</h2>
          <p>{DEFENSE_FABRIC_COPY.body}</p>
        </div>

        <div className="arch-tabs" role="tablist" aria-label="Architecture diagrams">
          {ARCHITECTURE_GRAPHS.map((g) => (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={graphId === g.id}
              className={`arch-tab${graphId === g.id ? ' arch-tab-active' : ''}`}
              onClick={() => switchGraph(g.id)}
            >
              {g.title}
            </button>
          ))}
        </div>

        <div className="arch-layout" role="tabpanel">
          <div className="arch-main">
            <div className="arch-toolbar">
              <div>
                <h3>{graph.title}</h3>
                <p className="muted">{graph.subtitle}</p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-pill arch-play-btn"
                onClick={playFlow}
                disabled={playing}
              >
                {playing ? 'Playing…' : 'Play flow'}
              </button>
            </div>

            <ArchitectureCanvas
              graph={graph}
              selectedId={selectedId}
              hoverId={hoverId}
              onSelect={setSelectedId}
              onHover={setHoverId}
            />

            <details className="arch-static-fallback">
              <summary>View static diagram</summary>
              <figure>
                <Image
                  src={graph.staticImage}
                  alt={graph.staticImageAlt}
                  width={1400}
                  height={900}
                  style={{ width: '100%', height: 'auto', borderRadius: 12 }}
                />
                <figcaption className="muted">
                  {SITE_NAME} {graph.title} — reference diagram
                </figcaption>
              </figure>
            </details>
          </div>

          <ArchitectureDetailPanel
            graph={graph}
            node={selectedNode}
            connectedLabels={connectedLabels}
          />
        </div>
      </section>
    </RevealOnScroll>
  );
}
