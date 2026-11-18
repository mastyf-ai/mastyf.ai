/** Shield's blocked calls as rows for the panel, with the same names and labels as Shield's window. */
import { LAYER_NAMES, RULE_NAMES } from './names';
import type { Receipt } from './shield';

export interface BlockRow {
  id: string;
  tool: string;
  server: string;
  agent: string;
  /** The agent id Shield recorded for the call (Shield 0.6+), e.g. "vscode" or "claude-code". */
  agentId?: string;
  at: string | null;
  layer?: string;
  rule?: string;
  reason: string;
  match?: string;
  matchLabel?: 'Matched' | 'Found' | 'Passage it flagged';
  field?: string;
  confidence?: number;
}

const MATCH_MAX = 160;
const own = (names: Record<string, string>, key: string | undefined): string | undefined =>
  key !== undefined && Object.prototype.hasOwnProperty.call(names, key) ? names[key] : undefined;
const clip = (text: string) => (text.length > MATCH_MAX ? `${text.slice(0, MATCH_MAX)}…` : text);

function matchLabelFor(layer: string | undefined): BlockRow['matchLabel'] {
  if (layer === 'protocol-x') return 'Passage it flagged';
  if (layer === 'secret-scan') return 'Found';
  return 'Matched';
}

function toRow(r: Receipt): BlockRow {
  const tool = r.tool_name || '(unknown tool)';
  const row: BlockRow = {
    // Without an id from Shield, one made from the call itself, so it stays the same on every poll.
    id: r.receipt_id || r.request_id || `${r.timestamp_utc ?? 'no-time'}|${tool}|${r.server_name ?? ''}|${r.reason_code ?? ''}`,
    tool,
    server: r.server_name || '(unknown server)',
    agent: r.caller_agent || 'unknown agent',
    at: r.timestamp_utc || null,
    reason: r.enforcement_reason || r.reason_code || 'Blocked',
  };
  if (r.caller_agent) row.agentId = r.caller_agent;
  if (r.block_layer) row.layer = own(LAYER_NAMES, r.block_layer) ?? r.block_layer;
  const rule = own(RULE_NAMES, r.reason_code);
  if (rule) row.rule = rule;
  if (r.block_match) {
    row.match = clip(r.block_match);
    row.matchLabel = matchLabelFor(r.block_layer);
  }
  if (r.block_field) row.field = r.block_field;
  if (typeof r.block_confidence === 'number') row.confidence = r.block_confidence;
  return row;
}

/** Blocked calls only, in the order given (Shield sends newest first), at most `limit`. */
export function toBlockRows(receipts: Receipt[], limit: number): BlockRow[] {
  return receipts.filter((r) => r.decision === 'BLOCK').slice(0, limit).map(toRow);
}

/**
 * Whether a block came from this editor or its companions (Claude Code, Cline). Shield 0.6+ records
 * the agent for each call; for an older Shield, the server names in this editor's settings decide.
 */
export function fromThisEditor(row: BlockRow, agents: readonly string[], servers: ReadonlySet<string>): boolean {
  if (row.agentId) return agents.includes(row.agentId);
  return servers.has(row.server);
}

/** Confidence as Shield shows it: a fraction becomes a percentage. */
export function confidencePercent(c: number): number {
  return Math.round(c <= 1 ? c * 100 : c);
}

/** The text "Copy details" puts on the clipboard. */
export function blockDetailText(row: BlockRow): string {
  return [
    `Shield blocked ${row.tool} on ${row.server} (${row.agent})`,
    row.at ? `When: ${row.at}` : '',
    row.layer ? `Layer: ${row.layer}` : '',
    row.rule ? `Rule: ${row.rule}` : '',
    `Reason: ${row.reason}`,
    row.match ? `${row.matchLabel}: ${row.match}` : '',
    row.field ? `Argument: ${row.field}` : '',
    typeof row.confidence === 'number' ? `Confidence: ${confidencePercent(row.confidence)}%` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
