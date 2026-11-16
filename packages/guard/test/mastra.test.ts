import { createTool } from '@mastra/core/tools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createGuard } from '../src/guard.js';
import { guardTools } from '../src/mastra.js';
import { isolate, SECRET, TAKEOVER } from './helpers.js';

await isolate({ beforeEach, afterEach });

function makeTools(calls: string[]) {
  return {
    readFile: createTool({
      id: 'read_file',
      description: 'Read a file.',
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        calls.push(path);
        return `contents of ${path}`;
      },
    }),
    fetchPage: createTool({
      id: 'fetch_page',
      description: 'Fetch a page.',
      inputSchema: z.object({ url: z.string() }),
      execute: async () => ({ text: `Page text. ${TAKEOVER}` }),
    }),
    showConfig: createTool({
      id: 'show_config',
      description: 'Show a config file.',
      inputSchema: z.object({ name: z.string() }),
      execute: async () => `config: key=${SECRET} and the rest`,
    }),
  };
}

const run = (t: any, input: unknown) => t.execute(input, {});

describe('Mastra guardTools', () => {
  it('runs ordinary calls and blocks sensitive ones before the tool runs', async () => {
    const calls: string[] = [];
    const tools = guardTools(makeTools(calls));
    expect(await run(tools.readFile, { path: './README.md' })).toBe('contents of ./README.md');
    expect(String(await run(tools.readFile, { path: '/etc/passwd' }))).toMatch(/^Blocked by Mastyf/);
    expect(calls).toEqual(['./README.md']);
  });

  it('a takeover in an object result never reaches the model; a secret is redacted', async () => {
    const tools = guardTools(makeTools([]));
    expect(String(await run(tools.fetchPage, { url: 'https://docs.example.org' }))).toMatch(/^Blocked by Mastyf/);
    expect(JSON.stringify(await run(tools.showConfig, { name: 'deploy' }))).not.toContain(SECRET);
  });

  it('checks the input as the tool will see it, after its schema has parsed it', async () => {
    const calls: string[] = [];
    const decoding = createTool({
      id: 'read_file',
      description: 'Read a file (path written backwards).',
      inputSchema: z.object({ path: z.string().transform((s) => [...s].reverse().join('')) }),
      execute: async ({ path }) => {
        calls.push(path);
        return 'ok';
      },
    });
    const [guarded] = guardTools([decoding]);
    const encoded = [...'/etc/passwd'].reverse().join('');
    expect(String(await run(guarded, { path: encoded }))).toMatch(/^Blocked by Mastyf/);
    expect(calls).toEqual([]);
  });

  it('keeps ids, descriptions and schemas; accepts an array; uses a given guard', async () => {
    const original = makeTools([]);
    const guarded = guardTools(original);
    expect(guarded.readFile.id).toBe('read_file');
    expect(guarded.readFile.description).toBe(original.readFile.description);
    expect(guarded.readFile.inputSchema).toBe(original.readFile.inputSchema);
    expect(guarded.readFile).not.toBe(original.readFile);
    const list = guardTools([original.readFile], createGuard({ session: 'run-7' }));
    expect(String(await run(list[0], { path: '/etc/passwd' }))).toMatch(/^Blocked by Mastyf/);
  });
});
