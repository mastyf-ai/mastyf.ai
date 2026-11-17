/**
 * The job summary. It names the tool and the check, never what was matched: run pages of public
 * repositories are public, and a reason can quote an argument (a path, a URL).
 */

export interface Block {
  at: string;
  kind: string;
  tool?: string;
  layer?: string;
  rule?: string;
  reason?: string;
  outcome: 'blocked' | 'would-block' | 'redacted';
}

export interface SummaryOptions {
  showReasons: boolean;
  /** The service returned as many entries as it keeps (200): there may have been more. */
  capped: boolean;
  /** Whether this Action's service started (false: on-error: continue and it didn't). */
  serviceStarted: boolean;
}

const OUTCOME_TEXT: Record<Block['outcome'], string> = {
  blocked: 'blocked',
  'would-block': 'would block (observe mode)',
  redacted: 'secret hidden',
};

const FOOTER = ['', 'Free checks, run on this runner; nothing was sent to Mastyf.', 'Paid protection: [mastyf.ai](https://www.mastyf.ai)', ''].join('\n');

/**
 * Text shown exactly as written inside one Markdown table cell: no HTML, no links, images or
 * formatting, and no breaking the row. Tool names and reasons can come from whoever controls a tool.
 */
function cell(text: string | undefined): string {
  return (text ?? '')
    .replace(/\\/g, '\\\\') // first, so a backslash in the text can't undo the escapes below
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[|`[\]()!*~#]/g, (c) => `\\${c}`)
    .replace(/:\/\//g, '&#58;//') // no bare-URL autolinks (https://...)
    .replace(/www\./gi, (m) => `${m.slice(0, 3)}&#46;`) // nor www. autolinks
    .replace(/\r?\n|\r/g, ' ');
}

function time(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? cell(at) : d.toISOString().slice(11, 19);
}

export function counts(blocks: Block[]): { blocked: number; redacted: number } {
  let blocked = 0;
  let redacted = 0;
  for (const b of blocks) {
    if (b.outcome === 'redacted') redacted++;
    else blocked++;
  }
  return { blocked, redacted };
}

export function renderSummary(blocks: Block[] | null, opts: SummaryOptions): string {
  if (blocks === null) {
    const why = opts.serviceStarted
      ? "Mastyf's service for this job wasn't reachable at the end of the job, so this list is missing."
      : "Mastyf's service for this job didn't start; checks made by the libraries' own engine aren't listed here.";
    return `### Mastyf\n\n${why}\n${FOOTER}`;
  }
  if (blocks.length === 0) return `### Mastyf: nothing was blocked in this job\n${FOOTER}`;

  const { blocked, redacted } = counts(blocks);
  const more = opts.capped ? ' (200 or more entries; the oldest may be missing)' : '';
  const parts = [];
  if (blocked) parts.push(`${blocked} tool call${blocked === 1 ? '' : 's'} blocked`);
  if (redacted) parts.push(`${redacted} secret${redacted === 1 ? '' : 's'} hidden`);
  const lines = [`### Mastyf: ${parts.join(', ')} in this job${more}`, ''];
  const head = ['When (UTC)', 'Outcome', 'Kind', 'Tool', 'Check', ...(opts.showReasons ? ['Reason'] : [])];
  lines.push(`| ${head.join(' | ')} |`, `|${head.map(() => ' --- ').join('|')}|`);
  for (const b of blocks) {
    const check = [b.layer, b.rule].filter(Boolean).join(': ');
    const row = [time(b.at), OUTCOME_TEXT[b.outcome] ?? cell(b.outcome), cell(b.kind), cell(b.tool), cell(check), ...(opts.showReasons ? [cell(b.reason)] : [])];
    lines.push(`| ${row.join(' | ')} |`);
  }
  return `${lines.join('\n')}\n${FOOTER}`;
}
