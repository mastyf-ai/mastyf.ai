import type { ArchNode } from '@/lib/architecture-graph';

const GROUP_COLORS: Record<ArchNode['group'], string> = {
  ci: '#3b82f6',
  runtime: '#16a34a',
  external: '#c5a059',
  threat: '#6366f1',
  human: '#d97706',
  output: '#16a34a',
  research: '#8b5cf6',
  fabric: '#0a1128',
};

type Props = {
  node: ArchNode;
  active: boolean;
  highlighted: boolean;
  dimmed?: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
};

export function ArchitectureNode({ node, active, highlighted, dimmed, onSelect, onHover }: Props) {
  const color = GROUP_COLORS[node.group];

  return (
    <g
      role="button"
      tabIndex={0}
      className={`arch-node${active ? ' arch-node-active' : ''}${highlighted ? ' arch-node-highlighted' : ''}${dimmed ? ' arch-node-dimmed' : ''}`}
      transform={`translate(${node.x}, ${node.y})`}
      onClick={() => onSelect(node.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(node.id);
        }
      }}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      aria-pressed={active}
      aria-label={`${node.label}: ${node.short}`}
    >
      <rect
        width={120}
        height={44}
        rx={10}
        className="arch-node-bg"
        style={{ stroke: color }}
      />
      <text x={60} y={18} className="arch-node-short" style={{ fill: color }}>
        {node.short}
      </text>
      <text x={60} y={34} className="arch-node-label">
        {node.label.length > 16 ? `${node.label.slice(0, 14)}…` : node.label}
      </text>
    </g>
  );
}
