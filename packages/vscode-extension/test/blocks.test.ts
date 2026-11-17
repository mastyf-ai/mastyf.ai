import { describe, expect, it } from 'vitest';
import { blockDetailText, toBlockRows } from '../src/blocks';
import type { Receipt } from '../src/shield';

const hook: Receipt = {
  receipt_id: 'r1',
  timestamp_utc: '2026-11-13T10:00:00Z',
  tool_name: 'read_file',
  server_name: 'shield-demo',
  caller_agent: 'claude-code',
  decision: 'BLOCK',
  reason_code: 'hook-before',
  enforcement_reason: 'hook-before: Path not in allowed list: /etc/passwd',
  block_layer: 'hooks',
  block_match: '/etc/passwd',
  block_field: 'path',
};

describe('toBlockRows', () => {
  it('keeps blocked calls only, in order, up to the limit', () => {
    const rows = toBlockRows(
      [hook, { ...hook, receipt_id: 'r2', decision: 'ALLOW' }, { ...hook, receipt_id: 'r3' }, { ...hook, receipt_id: 'r4' }],
      2,
    );
    expect(rows.map((r) => r.id)).toEqual(['r1', 'r3']);
  });

  it("names the layer the way Shield's window does", () => {
    const [row] = toBlockRows([hook], 25);
    expect(row).toMatchObject({
      tool: 'read_file',
      server: 'shield-demo',
      agent: 'claude-code',
      at: '2026-11-13T10:00:00Z',
      layer: 'Tool-call hook',
      reason: 'hook-before: Path not in allowed list: /etc/passwd',
      match: '/etc/passwd',
      matchLabel: 'Matched',
      field: 'path',
    });
  });

  it('adds the rule name when Shield knows it, and labels Protocol X and secret-scan matches', () => {
    const [px] = toBlockRows([{ ...hook, reason_code: 'protocol-x-result', block_layer: 'protocol-x', block_confidence: 0.95 }], 25);
    expect(px).toMatchObject({ layer: 'Protocol X', rule: "Attack in a tool's answer", matchLabel: 'Passage it flagged', confidence: 0.95 });
    const [secret] = toBlockRows([{ ...hook, reason_code: 'secret-scan', block_layer: 'secret-scan', block_match: 'aws-key' }], 25);
    expect(secret).toMatchObject({ layer: 'Secret scan', rule: 'Secrets in the arguments', matchLabel: 'Found' });
  });

  it('an unknown layer shows as recorded', () => {
    expect(toBlockRows([{ ...hook, block_layer: 'new-layer' }], 25)[0].layer).toBe('new-layer');
  });

  it('a block with almost nothing recorded still gives a readable row', () => {
    const [row] = toBlockRows([{ decision: 'BLOCK' }], 25);
    expect(row).toMatchObject({ tool: '(unknown tool)', server: '(unknown server)', agent: 'unknown agent', at: null, reason: 'Blocked' });
    expect(row.layer).toBeUndefined();
    expect(row.matchLabel).toBeUndefined();
    expect(row.id).toBeTruthy();
  });

  it('clips a long match to 160 characters', () => {
    const [row] = toBlockRows([{ ...hook, block_match: 'x'.repeat(300) }], 25);
    expect(row.match).toBe('x'.repeat(160) + '…');
  });
});

describe('blockDetailText', () => {
  it('is plain text with each detail on its own line', () => {
    const text = blockDetailText(toBlockRows([hook], 25)[0]);
    expect(text).toContain('Shield blocked read_file on shield-demo (claude-code)');
    expect(text).toContain('Layer: Tool-call hook');
    expect(text).toContain('Reason: hook-before: Path not in allowed list: /etc/passwd');
    expect(text).toContain('Matched: /etc/passwd');
    expect(text).toContain('Argument: path');
  });
});
