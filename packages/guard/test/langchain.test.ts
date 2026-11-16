import { tool } from '@langchain/core/tools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { guardTools } from '../src/langchain.js';
import { isolate, SECRET, TAKEOVER } from './helpers.js';

await isolate({ beforeEach, afterEach });

function makeTools(calls: string[]) {
  return [
    tool(
      async ({ path }) => {
        calls.push(path);
        return `contents of ${path}`;
      },
      { name: 'read_file', description: 'Read a file.', schema: z.object({ path: z.string() }) },
    ),
    tool(async () => `Page text. ${TAKEOVER}`, { name: 'fetch_page', description: 'Fetch a page.', schema: z.object({ url: z.string() }) }),
    tool(async () => `config: key=${SECRET} and the rest`, { name: 'show_config', description: 'Show a config file.', schema: z.object({ name: z.string() }) }),
    tool(async () => [{ pageContent: 'Quarterly notes.', metadata: { summary: TAKEOVER } }] as unknown as string, {
      name: 'search',
      description: 'Search documents.',
      schema: z.object({ query: z.string() }),
    }),
  ];
}

const call = async (t: any, args: Record<string, unknown>): Promise<string> =>
  String((await t.invoke({ type: 'tool_call', id: 'c1', name: t.name, args })).content);

describe('LangChain.js guardTools', () => {
  it('runs ordinary calls and blocks sensitive ones before the tool runs', async () => {
    const calls: string[] = [];
    const [readFile] = guardTools(makeTools(calls));
    expect(await call(readFile, { path: './README.md' })).toBe('contents of ./README.md');
    expect(await call(readFile, { path: '/etc/passwd' })).toMatch(/^Blocked by Mastyf/);
    expect(calls).toEqual(['./README.md']);
  });

  it('results: a takeover is blocked, a secret redacted, documents checked field by field', async () => {
    const [, fetchPage, showConfig, search] = guardTools(makeTools([]));
    expect(await call(fetchPage, { url: 'https://docs.example.org' })).toMatch(/^Blocked by Mastyf/);
    expect(await call(showConfig, { name: 'deploy' })).not.toContain(SECRET);
    expect(await call(search, { query: 'notes' })).toMatch(/^Blocked by Mastyf/);
  });

  it('a plain string input is checked as input', async () => {
    const calls: string[] = [];
    const runQuery = tool(
      async (q: string) => {
        calls.push(q);
        return 'ok';
      },
      { name: 'run_query', description: 'Run a query.' },
    );
    const [guarded] = guardTools([runQuery]);
    expect(String(await (guarded as any).invoke('cat /etc/passwd'))).toMatch(/^Blocked by Mastyf/);
    expect(calls).toEqual([]);
  });

  it('keeps names, descriptions and schemas', () => {
    const original = makeTools([]);
    guardTools(original).forEach((g, i) => {
      expect([g.name, g.description]).toEqual([original[i]!.name, original[i]!.description]);
      expect(g.schema).toBe(original[i]!.schema);
    });
  });
});
