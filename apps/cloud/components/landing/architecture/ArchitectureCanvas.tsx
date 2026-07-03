import type { ArchitectureGraph } from '@/lib/architecture-graph';
import { getConnectedEdgeIds } from '@/lib/architecture-graph';
import { ArchitectureEdge } from './ArchitectureEdge';
import { ArchitectureNode } from './ArchitectureNode';

type Props = {
  graph: ArchitectureGraph;
  selectedId: string;
  hoverId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
};

export function ArchitectureCanvas({ graph, selectedId, hoverId, onSelect, onHover }: Props) {
  const focusId = hoverId ?? selectedId;
  const connected = focusId ? getConnectedEdgeIds(graph, focusId) : new Set<string>();
  const hasFocus = Boolean(focusId);

  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  return (
    <div className="arch-canvas-wrap">
      <svg
        viewBox={graph.viewBox}
        className="arch-canvas"
        role="img"
        aria-label={`${graph.title} interactive diagram`}
      >
        <defs>
          <marker
            id="arch-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="4"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 Z" className="arch-arrow-head" />
          </marker>
        </defs>

        {/* CI track band */}
        {graph.id === 'swarm' ? (
          <>
            <rect x={90} y={30} width={660} height={70} rx={12} className="arch-band arch-band-ci" />
            <text x={100} y={48} className="arch-band-label">
              CI Swarm (PR + Nightly)
            </text>
            <rect x={240} y={170} width={500} height={130} rx={12} className="arch-band arch-band-runtime" />
            <text x={250} y={188} className="arch-band-label">
              Runtime Swarm (Production)
            </text>
          </>
        ) : null}

        {graph.id === 'defense-fabric' ? (
          <>
            <rect x={40} y={60} width={800} height={90} rx={12} className="arch-band arch-band-fabric" />
            <text x={50} y={78} className="arch-band-label">
              tools/call defense orchestrator
            </text>
          </>
        ) : null}

        {graph.edges.map((edge) => {
          const fromNode = nodeMap.get(edge.from);
          const toNode = nodeMap.get(edge.to);
          if (!fromNode || !toNode) return null;
          const edgeId = `${edge.from}-${edge.to}`;
          const active = connected.has(edgeId);
          const dimmed = hasFocus && !active;
          return (
            <ArchitectureEdge
              key={edgeId}
              edge={edge}
              fromNode={fromNode}
              toNode={toNode}
              active={active}
              dimmed={dimmed}
            />
          );
        })}

        {graph.nodes.map((node) => {
          const active = selectedId === node.id;
          const isFocus = focusId === node.id;
          const isConnected =
            Boolean(focusId) &&
            graph.edges.some(
              (e) =>
                (e.from === focusId && e.to === node.id) ||
                (e.to === focusId && e.from === node.id),
            );
          const highlighted = isFocus || isConnected;
          const dimmed = hasFocus && !highlighted;
          return (
            <ArchitectureNode
              key={node.id}
              node={node}
              active={active}
              highlighted={highlighted}
              dimmed={dimmed}
              onSelect={onSelect}
              onHover={onHover}
            />
          );
        })}
      </svg>
    </div>
  );
}
