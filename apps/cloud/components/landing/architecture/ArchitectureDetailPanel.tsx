import type { ArchNode, ArchitectureGraph } from '@/lib/architecture-graph';

type Props = {
  graph: ArchitectureGraph;
  node: ArchNode | null;
  connectedLabels: string[];
};

export function ArchitectureDetailPanel({ graph, node, connectedLabels }: Props) {
  if (!node) {
    return (
      <aside className="arch-detail card-elevated">
        <p className="arch-detail-hint muted">
          Click any node in the <strong>{graph.title}</strong> diagram to explore how it works.
        </p>
      </aside>
    );
  }

  return (
    <aside className="arch-detail card-elevated">
      <span className={`arch-detail-group arch-detail-group-${node.group}`}>{node.group}</span>
      <h3>{node.label}</h3>
      <p>{node.description}</p>
      {connectedLabels.length > 0 ? (
        <div className="arch-detail-links">
          <span className="arch-detail-links-label">Connected to</span>
          <ul>
            {connectedLabels.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}
