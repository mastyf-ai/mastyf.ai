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
    expect(row).toContain('line | two'.replaceAll('|', '\\|'));
    expect(md).not.toContain('<script>');
    expect(md).not.toContain('<img');
  });

  it('never turns a name or reason into a link, image or formatting', () => {
    const phish: Block = { ...blocked, tool: '[click here](https://evil.example/login)', reason: '![x](https://evil.example/p.png) **bold** see https://evil.example \\| end' };
    const md = renderSummary([phish], { ...opts, showReasons: true });
    const row = md.split('\n').find((l) => l.includes('click here'))!;
    expect(row).not.toMatch(/\]\(/); // no [text](url)
    expect(row).not.toContain('https://'); // no bare autolink
    expect(row).not.toContain('**');
    expect(row.split(' | ').length).toBe(6); // the backslash didn't un-escape a pipe: still 6 cells
  });
});

describe('counts', () => {
  it('counts would-be blocks as blocked and hidden secrets separately', () => {
    expect(counts([blocked, would, hidden])).toEqual({ blocked: 2, redacted: 1 });
  });
});

describe('size', () => {
  it('a huge tool name cannot push the summary past what GitHub shows', () => {
    const huge: Block = { ...blocked, tool: 'x'.repeat(2_000_000) };
    const md = renderSummary(Array.from({ length: 200 }, () => huge), { ...opts, showReasons: true });
    expect(Buffer.byteLength(md)).toBeLessThan(900 * 1024);
    expect(md).toContain('…');
    expect(md).toContain('Free checks, run on this runner; nothing was sent to Mastyf.');
  });
});
