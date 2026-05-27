import { describe, expect, it } from 'vitest';
import { parseAutoResearchLogTail } from '../../src/utils/parse-auto-research-log.js';

describe('parseAutoResearchLogTail', () => {
  it('parses wrote summary and skip reasons from job log tail', () => {
    const parsed = parseAutoResearchLogTail(`
[2026-05-27T20:32:53.284Z] Starting auto-research
[auto-threat-research] wrote 0/10 fixture(s)
  ✗ duplicate fingerprint
  ✗ duplicate fingerprint
  ✗ duplicate fingerprint
  ✗ duplicate fingerprint
  ✗ below min confidence
  ✗ below min confidence
  ✗ below min confidence
  ✗ duplicate fingerprint
  ✗ duplicate fingerprint
  ✗ duplicate fingerprint
`);

    expect(parsed.summaryLine).toBe('[auto-threat-research] wrote 0/10 fixture(s)');
    expect(parsed.written).toBe(0);
    expect(parsed.attempted).toBe(10);
    expect(parsed.skips.duplicate).toBe(7);
    expect(parsed.skips.belowMinConfidence).toBe(3);
    expect(parsed.skips.other).toBe(0);
  });

  it('returns safe defaults when no summary line is present', () => {
    const parsed = parseAutoResearchLogTail('startup only');
    expect(parsed.summaryLine).toBeNull();
    expect(parsed.written).toBe(0);
    expect(parsed.attempted).toBe(0);
    expect(parsed.skips.duplicate).toBe(0);
    expect(parsed.skips.belowMinConfidence).toBe(0);
    expect(parsed.skips.other).toBe(0);
  });
});
