import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ActivityUploader,
  eventFromCallRecord,
  resolveActivitySink,
} from '../../src/telemetry/activity-uploader.js';
import type { ProxyCallRecord } from '../../src/types.js';

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-home-'));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  vi.useRealTimers();
});

const record = (over: Partial<ProxyCallRecord> = {}): ProxyCallRecord => ({
  serverName: 'shield-demo',
  toolName: 'add_numbers',
  requestTokens: 10,
  responseTokens: 5,
  totalTokens: 15,
  durationMs: 139,
  timestamp: '2026-11-12T09:59:00.000Z',
  ...over,
});

describe('where activity goes', () => {
  it('uses the key the connect command saved', () => {
    fs.mkdirSync(path.join(home, '.mastyf-ai'));
    fs.writeFileSync(path.join(home, '.mastyf-ai', 'connect.json'), JSON.stringify({ instanceId: 'inst-1', key: 'mk_free', agents: [] }));
    expect(resolveActivitySink({}, home)).toEqual({ key: 'mk_free', instanceId: 'inst-1', baseUrl: 'https://www.mastyf.ai', device: undefined });
  });

  it("prefers a key given in the environment, as Shield's launcher does", () => {
    const sink = resolveActivitySink(
      { MASTYF_AI_ACTIVITY_KEY: 'MG-AAAA', MASTYF_SHIELD_SITE_URL: 'https://example.test/', MASTYF_AI_DEVICE_NAME: 'shield-abc' },
      home,
    );
    expect(sink).toMatchObject({ key: 'MG-AAAA', baseUrl: 'https://example.test', device: 'shield-abc' });
    expect(sink?.instanceId).toMatch(/^[A-Za-z0-9_-]{4,64}$/);
  });

  it('sends nothing without a key, or when turned off', () => {
    expect(resolveActivitySink({}, home)).toBeNull();
    expect(resolveActivitySink({ MASTYF_AI_ACTIVITY_KEY: 'k', MASTYF_AI_ACTIVITY_UPLOAD: 'false' }, home)).toBeNull();
  });
});

describe('what is sent for a call', () => {
  it('describes a blocked call with its rule and a redacted snippet', () => {
    const e = eventFromCallRecord(
      record({ blocked: true, blockRule: 'prompt-injection', blockReason: 'r'.repeat(500), argumentSnippet: 'note=ignore previous; token=ghp_' + 'a'.repeat(30) }),
      undefined,
      'cursor',
    );
    expect(e).toMatchObject({ verdict: 'block', rule: 'prompt-injection', agent: 'cursor', server: 'shield-demo', direction: 'call', latencyMs: 139 });
    expect(e.reason!.length).toBeLessThanOrEqual(300);
    expect(e.snippet).toContain('note=ignore previous');
    expect(e.snippet).not.toContain('ghp_');
  });

  it('fingerprints arguments with the workspace key, so a stored fingerprint cannot be guessed back', async () => {
    const { fingerprintArgs } = await import('../../src/ai/block-learning.js');
    const msg = { params: { arguments: { pin: '1234' } } };
    const a = eventFromCallRecord(record(), msg, undefined, 'key-one');
    const b = eventFromCallRecord(record(), msg, undefined, 'key-one');
    const c = eventFromCallRecord(record(), msg, undefined, 'key-two');
    expect(a.fingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
    expect(a.fingerprint).not.toBe(fingerprintArgs(msg.params.arguments));
    expect(eventFromCallRecord(record(), msg, undefined).fingerprint).toBeNull();
  });

  it('redacts an allowed call from its arguments: secret keys and secret-looking values', () => {
    const e = eventFromCallRecord(record(), { params: { arguments: { path: '/tmp/a.txt', apiKey: 'plain', cmd: 'curl -H "x: sk-ant-' + 'b'.repeat(30) + '"' } } }, undefined, 'k');
    expect(e.verdict).toBe('allow');
    expect(e.snippet).toContain('path=/tmp/a.txt');
    expect(e.snippet).not.toContain('plain');
    expect(e.snippet).not.toContain('sk-ant-');
    expect(e.fingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(e.id).toMatch(/^[A-Za-z0-9_-]{4,64}$/);
  });
});

describe('sending', () => {
  const sink = { key: 'mk_free', instanceId: 'inst-1', baseUrl: 'https://example.test', device: 'shield-abc' };

  it('batches events into one POST with the key and device', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const up = new ActivityUploader(sink, { fetchImpl, flushMs: 60_000 });
    up.enqueue(eventFromCallRecord(record(), undefined, undefined));
    up.enqueue(eventFromCallRecord(record({ blocked: true }), undefined, undefined));
    await up.flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://example.test/api/v1/events');
    expect(init.headers).toMatchObject({ authorization: 'Bearer mk_free', 'x-mastyf-device': 'shield-abc' });
    const body = JSON.parse(init.body);
    expect(body.instanceId).toBe('inst-1');
    expect(body.events).toHaveLength(2);
    up.stop();
  });

  it('stops sending after the site refuses the key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    const up = new ActivityUploader(sink, { fetchImpl, flushMs: 60_000 });
    up.enqueue(eventFromCallRecord(record(), undefined, undefined));
    await up.flush();
    up.enqueue(eventFromCallRecord(record(), undefined, undefined));
    await up.flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    up.stop();
  });

  it('keeps events for a retry when the site is unreachable, up to a cap', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    const up = new ActivityUploader(sink, { fetchImpl, flushMs: 60_000, maxQueue: 3 });
    for (let i = 0; i < 5; i++) up.enqueue(eventFromCallRecord(record(), undefined, undefined));
    expect(up.pending()).toBe(3);
    await up.flush();
    expect(up.pending()).toBe(3);
    fetchImpl.mockResolvedValue({ ok: true, status: 200 });
    await up.flush();
    expect(up.pending()).toBe(0);
    up.stop();
  });
});
