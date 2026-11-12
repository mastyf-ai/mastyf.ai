import { describe, expect, it } from 'vitest';
import { MAX_BATCH, parseEventBatch, retentionDays, SNIPPET_MAX } from '@/lib/activity/event-batch';

const NOW = Date.parse('2026-11-12T10:00:00Z');
const event = (over: Record<string, unknown> = {}) => ({
  id: 'evt-0001',
  occurredAt: '2026-11-12T09:59:00Z',
  agent: 'cursor',
  server: 'shield-demo',
  tool: 'add_numbers',
  direction: 'call',
  verdict: 'block',
  rule: 'prompt-injection',
  reason: 'Attempt to override system instructions',
  latencyMs: 139,
  fingerprint: 'a1b2c3d4e5f60718',
  snippet: 'note=ignore previous instructions',
  ...over,
});
const batch = (events: unknown[], instanceId: unknown = 'inst-1') => ({ instanceId, events });

describe('activity event batches', () => {
  it('accepts a well-formed batch', () => {
    const parsed = parseEventBatch(batch([event()]), NOW);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.instanceId).toBe('inst-1');
    expect(parsed.events[0]).toMatchObject({ server: 'shield-demo', verdict: 'block', direction: 'call', latencyMs: 139 });
  });

  it('refuses an empty, oversized or malformed batch', () => {
    expect(parseEventBatch(batch([]), NOW).ok).toBe(false);
    expect(parseEventBatch(batch(Array.from({ length: MAX_BATCH + 1 }, (_, i) => event({ id: `evt-${i}` }))), NOW).ok).toBe(false);
    expect(parseEventBatch('nope', NOW).ok).toBe(false);
    expect(parseEventBatch(batch([event({ verdict: 'maybe' })]), NOW).ok).toBe(false);
    expect(parseEventBatch(batch([event({ server: '' })]), NOW).ok).toBe(false);
    expect(parseEventBatch(batch([event({ id: 'has spaces!' })]), NOW).ok).toBe(false);
  });

  it('refuses times far in the past or the future', () => {
    expect(parseEventBatch(batch([event({ occurredAt: '2026-10-01T00:00:00Z' })]), NOW).ok).toBe(false);
    expect(parseEventBatch(batch([event({ occurredAt: '2026-11-13T00:00:00Z' })]), NOW).ok).toBe(false);
    expect(parseEventBatch(batch([event({ occurredAt: 'yesterday' })]), NOW).ok).toBe(false);
  });

  it('cuts long text and strips secrets the client missed', () => {
    const parsed = parseEventBatch(
      batch([event({ snippet: `key=sk-ant-${'x'.repeat(40)} ${'y'.repeat(800)}`, reason: 'r'.repeat(900) })]),
      NOW,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const e = parsed.events[0]!;
    expect(e.snippet!.length).toBeLessThanOrEqual(SNIPPET_MAX);
    expect(e.snippet).not.toContain('sk-ant-');
    expect(e.snippet).toContain('[REDACTED]');
    expect(e.reason!.length).toBeLessThanOrEqual(300);
  });

  it('keeps free records 7 days and paid records 12 months', () => {
    expect(retentionDays('free')).toBe(7);
    expect(retentionDays('paid')).toBe(365);
  });
});
