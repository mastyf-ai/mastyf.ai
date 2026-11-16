import { afterEach, describe, expect, it } from 'vitest';
import { CheckClient } from '../src/client.js';
import { MastyfUnavailableError, isBlocked, modelMessage, type Verdict } from '../src/verdict.js';
import { fakeService, TOKEN, type Fake } from './helpers.js';

let svc: Fake | undefined;
afterEach(async () => {
  await svc?.close();
  svc = undefined;
});

describe('CheckClient', () => {
  it('sends the call with the token and reads the verdict', async () => {
    svc = await fakeService(() => [200, { decision: 'block', id: 'v1', layer: 'hooks', rule: 'hook-before', reason: 'Path not in allowed list' }]);
    const v = await new CheckClient(svc.url, TOKEN).checkCall('read_file', { path: '/etc/passwd' }, { server: 'files', session: 's1' });
    expect(v).toEqual({ decision: 'block', id: 'v1', layer: 'hooks', rule: 'hook-before', reason: 'Path not in allowed list' });
    expect(svc.requests[0]).toEqual({
      path: '/v1/check/call',
      auth: `Bearer ${TOKEN}`,
      body: { tool: 'read_file', arguments: { path: '/etc/passwd' }, server: 'files', session: 's1' },
    });
  });

  it('reads a redacted result', async () => {
    svc = await fakeService(() => [200, { decision: 'redact', id: 'v2', result: { content: '[REDACTED]' } }]);
    const v = await new CheckClient(svc.url, TOKEN).checkResult('read_file', { content: 'x' }, { server: 'f', session: 's' });
    expect(v.decision).toBe('redact');
    expect(v.result).toEqual({ content: '[REDACTED]' });
    expect(svc.requests[0]!.path).toBe('/v1/check/result');
  });

  it('registerTools returns null when the list is allowed', async () => {
    svc = await fakeService(() => [200, { decision: 'allow', id: 'tools' }]);
    expect(await new CheckClient(svc.url, TOKEN).registerTools('files', [{ name: 'read_file' }], { session: 's' })).toBeNull();
    expect(svc.requests[0]!.body.tools).toEqual([{ name: 'read_file' }]);
  });

  it.each([401, 413, 500])('a %i means no check could be made', async (status) => {
    svc = await fakeService(() => [status, { error: 'no' }]);
    await expect(new CheckClient(svc.url, TOKEN).checkCall('x', {}, { server: 's', session: 't' })).rejects.toBeInstanceOf(MastyfUnavailableError);
  });

  it('an answer that is not a verdict means no check could be made', async () => {
    svc = await fakeService(() => [200, { decision: 'maybe' }]);
    await expect(new CheckClient(svc.url, TOKEN).checkCall('x', {}, { server: 's', session: 't' })).rejects.toBeInstanceOf(MastyfUnavailableError);
  });

  it('unreachable means unavailable, and the error never carries the request', async () => {
    const err = await new CheckClient('http://127.0.0.1:9', TOKEN, 1000).checkCall('x', { secret: 'hunter2' }, { server: 's', session: 't' }).catch((e) => e);
    expect(err).toBeInstanceOf(MastyfUnavailableError);
    expect(String(err.message)).not.toContain(TOKEN);
    expect(String(err.message)).not.toContain('hunter2');
  });

  it('health is null when unreachable and is read without the token', async () => {
    expect(await new CheckClient('http://127.0.0.1:9', TOKEN, 1000).health()).toBeNull();
    svc = await fakeService(() => [200, { status: 'ready', tier: 'free' }]);
    expect(await new CheckClient(svc.url, TOKEN).health('n'.repeat(32))).toEqual({ status: 'ready', tier: 'free' });
    expect(svc.requests[0]).toMatchObject({ path: `/v1/health?nonce=${'n'.repeat(32)}`, auth: undefined });
  });
});

describe('modelMessage', () => {
  it('names the check, never the matched text', () => {
    const v: Verdict = { decision: 'block', id: 'x', layer: 'hooks', rule: 'hook-before', reason: 'Path not in allowed list: /etc/passwd' };
    expect(modelMessage(v)).toBe('Blocked by Mastyf (hooks: hook-before).');
    expect(modelMessage({ decision: 'block', id: 'x' })).toBe('Blocked by Mastyf.');
    expect(modelMessage({ decision: 'block', id: 'x', layer: 'answer-check' })).toBe('Blocked by Mastyf (answer-check).');
    expect(isBlocked(v)).toBe(true);
    expect(isBlocked({ decision: 'allow', id: 'y' })).toBe(false);
  });
});
