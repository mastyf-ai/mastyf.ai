import { describe, expect, it } from 'vitest';
import { counts, renderSummary, type Block } from '../src/summary.js';

const at = '2026-11-17T10:42:07.000Z';
const blocked: Block = { at, kind: 'call', tool: 'read_file', layer: 'policy', rule: 'semantic-path-guard', reason: 'Sensitive path blocked: /etc/passwd', outcome: 'blocked' };
const blocked2: Block = { ...blocked, tool: 'fetch_page', kind: 'result', layer: 'hooks', rule: 'injection-scan' };
const hidden: Block = { at, kind: 'result', tool: 'show_config', reason: 'Secret redacted', outcome: 'redacted' };
const would: Block = { ...blocked, outcome: 'would-block' };
const opts = { showReasons: false, capped: false, serviceStarted: true };
const FOOTER1 = 'Free checks, run on this runner; nothing was sent to Mastyf.';
const FOOTER2 = 'Paid protection: [mastyf.ai](https://www.mastyf.ai)';

describe('renderSummary', () => {
  it('says when nothing was blocked', () => {
    const md = renderSummary([], opts);
    expect(md).toContain('nothing was blocked in this job');
    expect(md).toContain(FOOTER1);
    expect(md).toContain(FOOTER2);
  });

  it('lists blocked calls and hidden secrets, without reasons by default', () => {
    const md = renderSummary([blocked, blocked2, hidden], opts);
    expect(md).toContain('2 tool calls blocked');
    expect(md).toContain('| blocked |');
    expect(md).toContain('| secret hidden |');
    expect(md).toContain('read_file');
    expect(md).toContain('policy: semantic-path-guard');
    expect(md).toContain('10:42:07');
    expect(md).not.toContain('/etc/passwd');
    expect(md).toContain(FOOTER1);
  });

  it('shows reasons only when asked', () => {
    expect(renderSummary([blocked], { ...opts, showReasons: true })).toContain('Sensitive path blocked: /etc/passwd');
  });

  it('marks observe-mode entries', () => {
    expect(renderSummary([would], opts)).toContain('would block (observe mode)');
  });

  it('says when the list was capped', () => {
    expect(renderSummary([blocked], { ...opts, capped: true })).toContain('200 or more');
  });

  it('explains a service that never started or went away', () => {
    expect(renderSummary(null, { ...opts, serviceStarted: false })).toContain("didn't start; checks made by the libraries' own engine aren't listed here");
    expect(renderSummary(null, opts)).toContain("wasn't reachable at the end of the job");
  });

  it('keeps hostile names and reasons inside one table row', () => {
    const nasty: Block = { ...blocked, tool: 'a|b`<script>', reason: 'line one\nline | two <img src=x>' };
    const md = renderSummary([nasty], { ...opts, showReasons: true });
    const row = md.split('\n').find((l) => l.includes('a\\|b'))!;
    expect(row).toBeDefined();
    expect(row).toContain('&lt;script&gt;');
    expect(row).toContain('&lt;img');
    expect(row).toContain('line | two'.replace('|', '\\|'));
    expect(md).not.toContain('<script>');
    expect(md).not.toContain('<img');
  });
});

describe('counts', () => {
  it('counts would-be blocks as blocked and hidden secrets separately', () => {
    expect(counts([blocked, would, hidden])).toEqual({ blocked: 2, redacted: 1 });
  });
});
