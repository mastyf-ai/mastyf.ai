// Regression tests for the final whole-branch review's findings.
import { tool } from '@langchain/core/tools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createGuard, _running } from '../src/guard.js';
import { guardTools as guardLangChain } from '../src/langchain.js';
import { guardTools as guardMastra } from '../src/mastra.js';
import { fakeService, isolate, TOKEN, waitFor, type Fake } from './helpers.js';

await isolate({ beforeEach, afterEach });

const fakes: Fake[] = [];
afterEach(async () => {
  for (const f of fakes.splice(0)) await f.close();
});

async function configuredService(health: Record<string, unknown>): Promise<Fake> {
  const f = await fakeService((p) => (p.startsWith('/v1/health') ? [200, health] : [200, { decision: 'allow', id: 'x' }]));
  fakes.push(f);
  process.env['MASTYF_CHECK_URL'] = f.url;
  process.env['MASTYF_CHECK_TOKEN'] = TOKEN;
  return f;
}

describe('LangChain.js keeps what LangGraph.js passes the tool', () => {
  it('passes the run config (configurable, the tool call) through to the tool', async () => {
    const whoami = tool(async (_input: { q: string }, config: any) => `user=${config?.configurable?.user} tc=${config?.toolCall?.id}`, {
      name: 'whoami',
      description: 'Who is asking.',
      schema: z.object({ q: z.string() }),
    });
    const [guarded] = guardLangChain([whoami]);
    const msg: any = await guarded!.invoke({ type: 'tool_call', id: 'call1', name: 'whoami', args: { q: 'x' } } as any, { configurable: { user: 'alice' } } as any);
    expect(msg.content).toBe('user=alice tc=call1');
    expect(msg.tool_call_id).toBe('call1');
  });

  it('parses a transforming schema once', async () => {
    const count = tool(async ({ ids }: { ids: string[] }) => String(ids.length), {
      name: 'count',
      description: 'Count ids.',
      schema: z.object({ ids: z.string().transform((s) => s.split(',')) }),
    });
    const [guarded] = guardLangChain([count]);
    const msg: any = await guarded!.invoke({ type: 'tool_call', id: 'c2', name: 'count', args: { ids: 'a,b' } } as any);
    expect(msg.content).toBe('2');
  });
});

describe('the engine', () => {
  it('concurrent checks after the engine dies restart it once and all succeed', async () => {
    const g = createGuard();
    await g.checkCall('read_file', { path: './README.md' });
    // Six checks are in flight on the old engine when it dies (the race the review found).
    const old = _running()!.child;
    const pending = Array.from({ length: 6 }, () => g.checkCall('read_file', { path: './README.md' }));
    old.kill();
    const results = await Promise.allSettled(pending);
    expect(old.exitCode !== null || old.signalCode !== null).toBe(true);
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value.decision : String(r.reason)))).toEqual(Array(6).fill('allow'));
    const pid = _running()!.child.pid;
    expect(_running()!.alive()).toBe(true);
    await g.checkCall('read_file', { path: './README.md' });
    expect(_running()!.child.pid).toBe(pid);
  });
});

describe('sessions', () => {
  it('session(name, fn) keeps concurrent runs apart', async () => {
    const svc = await configuredService({ status: 'ready', tier: 'free' });
    const g = createGuard({ session: 'default' });
    const run = (name: string) =>
      g.session(name, async () => {
        await new Promise((r) => setTimeout(r, 10));
        await g.checkCall('read_file', { path: name });
        await new Promise((r) => setTimeout(r, 20));
        await g.checkCall('read_file', { path: name });
      });
    await Promise.all([run('a'), run('b')]);
    const calls = svc.requests.filter((r) => r.path === '/v1/check/call').map((r) => r.body);
    expect(calls).toHaveLength(4);
    for (const c of calls) expect(c.session).toBe(c.arguments.path);
    expect(g.sessionId).toBe('default');
  });
});

describe('size limits', () => {
  it("a result over the service's limit is blocked without being sent, even in allow mode", async () => {
    const svc = await configuredService({ status: 'ready', tier: 'free', maxBodyBytes: 1000 });
    const v = await createGuard({ onUnavailable: 'allow' }).checkResult('fetch_page', 'a'.repeat(5000));
    expect(v.decision).toBe('block');
    expect(svc.requests.some((r) => r.path === '/v1/check/result')).toBe(false);
  });
});

describe('Mastra', () => {
  it('a tool without an id (a Vercel AI SDK tool) is checked under its key', async () => {
    const tools = guardMastra({
      echo: { description: 'Echo.', inputSchema: z.object({ text: z.string() }), execute: async ({ text }: { text: string }) => text } as any,
    });
    expect(await (tools.echo as any).execute({ text: 'hi' }, {})).toBe('hi');
  });
});
