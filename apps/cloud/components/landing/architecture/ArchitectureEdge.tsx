import type { ArchEdge, ArchNode } from '@/lib/architecture-graph';

type Props = {
  edge: ArchEdge;
  fromNode: ArchNode;
  toNode: ArchNode;
  active: boolean;
  dimmed: boolean;
};

function edgePath(from: ArchNode, to: ArchNode, loop?: boolean): string {
  const fx = from.x + 60;
  const fy = from.y + 22;
  const tx = to.x + 60;
  const ty = to.y + 22;

  if (loop) {
    const midY = Math.max(fy, ty) + 50;
    return `M ${fx} ${fy} C ${fx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`;
  }

  const mx = (fx + tx) / 2;
  return `M ${fx} ${fy} C ${mx} ${fy}, ${mx} ${ty}, ${tx} ${ty}`;
}

export function ArchitectureEdge({ edge, fromNode, toNode, active, dimmed }: Props) {
  const d = edgePath(fromNode, toNode, edge.loop);
  const id = `${edge.from}-${edge.to}`;

  return (
    <g className={`arch-edge${active ? ' arch-edge-active' : ''}${dimmed ? ' arch-edge-dimmed' : ''}`}>
      <path
        id={id}
        d={d}
        fill="none"
        className={`arch-edge-path${edge.animated ? ' arch-edge-animated' : ''}${edge.loop ? ' arch-edge-loop' : ''}`}
        markerEnd="url(#arch-arrow)"
      />
      {edge.label ? (
        <text className="arch-edge-label">
          <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">
            {edge.label}
          </textPath>
        </text>
      ) : null}
    </g>
  );
}
