/** Shield's blocked calls as rows for the panel, with the same names and labels as Shield's window. */
import { LAYER_NAMES, RULE_NAMES } from './names';
import type { Receipt } from './shield';

export interface BlockRow {
  id: string;
  tool: string;
  server: string;
  agent: string;
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
const clip = (text: string) => (text.length > MATCH_MAX ? `${text.slice(0, MATCH_MAX)}…` : text);

function matchLabelFor(layer: string | undefined): BlockRow['matchLabel'] {
  if (layer === 'protocol-x') return 'Passage it flagged';
  if (layer === 'secret-scan') return 'Found';
  return 'Matched';
}

function toRow(r: Receipt, index: number): BlockRow {
  const tool = r.tool_name || '(unknown tool)';
  const row: BlockRow = {
    id: r.receipt_id || r.request_id || `${r.timestamp_utc ?? 'no-time'}-${tool}-${index}`,
    tool,
    server: r.server_name || '(unknown server)',
    agent: r.caller_agent || 'unknown agent',
    at: r.timestamp_utc || null,
    reason: r.enforcement_reason || r.reason_code || 'Blocked',
  };
  if (r.block_layer) row.layer = LAYER_NAMES[r.block_layer] ?? r.block_layer;
  if (r.reason_code && RULE_NAMES[r.reason_code]) row.rule = RULE_NAMES[r.reason_code];
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
  return receipts
    .map((r, i) => [r, i] as const)
    .filter(([r]) => r.decision === 'BLOCK')
    .slice(0, limit)
    .map(([r, i]) => toRow(r, i));
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
