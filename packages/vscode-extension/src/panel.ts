/** The "Blocked calls" tree: one row per blocked call; expanding it shows what blocked it. */
import * as vscode from 'vscode';
import { blockDetailText, confidencePercent, type BlockRow } from './blocks';

export type PanelNode =
  | { kind: 'row'; row: BlockRow }
  | { kind: 'detail'; row: BlockRow; label: string }
  | { kind: 'empty'; label: string };

export type PanelState = 'ok' | 'shield-closed' | 'not-installed' | 'windows-only';

function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function detailLines(row: BlockRow): string[] {
  return [
    row.layer ? `Layer: ${row.layer}` : '',
    row.rule ? `Rule: ${row.rule}` : '',
    `Reason: ${row.reason}`,
    row.match ? `${row.matchLabel}: ${row.match}` : '',
    row.field ? `Argument: ${row.field}` : '',
    typeof row.confidence === 'number' ? `Confidence: ${confidencePercent(row.confidence)}%` : '',
  ].filter(Boolean);
}

export class BlocksPanel implements vscode.TreeDataProvider<PanelNode> {
  private readonly changed = new vscode.EventEmitter<PanelNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private rows: BlockRow[] = [];
  private nodes: PanelNode[] = [];
  private state: PanelState = 'ok';

  update(rows: BlockRow[], state: PanelState): void {
    this.rows = rows;
    this.state = state;
    this.nodes = rows.map((row) => ({ kind: 'row', row }));
    this.changed.fire(undefined);
  }

  nodeFor(rowId: string): PanelNode | undefined {
    return this.nodes.find((n) => n.kind === 'row' && n.row.id === rowId);
  }

  getChildren(node?: PanelNode): PanelNode[] {
    if (!node) {
      if (this.state === 'windows-only') return [{ kind: 'empty', label: 'Mastyf Shield runs on Windows for now' }];
      if (this.state === 'not-installed') return [{ kind: 'empty', label: 'Shield is not installed' }];
      if (this.state === 'shield-closed') return [{ kind: 'empty', label: 'Open Shield to see blocked calls' }];
      return this.rows.length ? this.nodes : [{ kind: 'empty', label: 'Nothing blocked yet' }];
    }
    if (node.kind === 'row') return detailLines(node.row).map((label) => ({ kind: 'detail', row: node.row, label }));
    return [];
  }

  getParent(node: PanelNode): PanelNode | undefined {
    return node.kind === 'detail' ? this.nodeFor(node.row.id) : undefined;
  }

  getTreeItem(node: PanelNode): vscode.TreeItem {
    if (node.kind === 'empty') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      if (node.label.startsWith('Open Shield')) item.command = { command: 'mastyfShield.openShield', title: 'Open Shield' };
      if (node.label.startsWith('Shield is not installed')) item.command = { command: 'mastyfShield.openDownload', title: 'Get Shield' };
      return item;
    }
    if (node.kind === 'detail') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.tooltip = node.label;
      return item;
    }
    const { row } = node;
    const item = new vscode.TreeItem(`${row.tool} on ${row.server}`, vscode.TreeItemCollapsibleState.Collapsed);
    item.id = row.id;
    item.description = [row.agent === 'unknown agent' ? '' : row.agent, ago(row.at)].filter(Boolean).join(' · ');
    item.tooltip = blockDetailText(row);
    item.iconPath = new vscode.ThemeIcon('shield');
    item.contextValue = 'block';
    return item;
  }
}
