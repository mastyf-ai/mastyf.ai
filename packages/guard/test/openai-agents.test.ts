import { RunContext, shellTool, tool, webSearchTool } from '@openai/agents';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { guardTools } from '../src/openai-agents.js';
import { isolate, SECRET, TAKEOVER } from './helpers.js';

await isolate({ beforeEach, afterEach });

function makeTools(calls: string[]) {
  return [
    tool({
      name: 'read_file',
      description: 'Read a file.',
      parameters: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        calls.push(path);
        return `contents of ${path}`;
      },
    }),
    tool({ name: 'fetch_page', description: 'Fetch a page.', parameters: z.object({ url: z.string() }), execute: async () => `Page text. ${TAKEOVER}` }),
    tool({ name: 'show_config', description: 'Show a config file.', parameters: z.object({ name: z.string() }), execute: async () => `config: key=${SECRET} and the rest` }),
  ];
}

const invoke = (t: any, input: string): Promise<unknown> => t.invoke(new RunContext(), input);

describe('OpenAI Agents JS guardTools', () => {
  it('runs ordinary calls and blocks sensitive ones before the tool runs', async () => {
    const calls: string[] = [];
    const [readFile] = guardTools(makeTools(calls));
    expect(await invoke(readFile, JSON.stringify({ path: './README.md' }))).toBe('contents of ./README.md');
    expect(String(await invoke(readFile, JSON.stringify({ path: '/etc/passwd' })))).toMatch(/^Blocked by Mastyf/);
    expect(calls).toEqual(['./README.md']);
  });

  it('results: a takeover is blocked, a secret redacted', async () => {
    const [, fetchPage, showConfig] = guardTools(makeTools([]));
    expect(String(await invoke(fetchPage, JSON.stringify({ url: 'https://docs.example.org' })))).toMatch(/^Blocked by Mastyf/);
    expect(String(await invoke(showConfig, JSON.stringify({ name: 'deploy' })))).not.toContain(SECRET);
  });

  it('arguments that are not JSON are checked as input', async () => {
    const calls: string[] = [];
    const [readFile] = guardTools(makeTools(calls));
    expect(String(await invoke(readFile, 'cat /etc/passwd'))).toMatch(/^Blocked by Mastyf/);
    expect(calls).toEqual([]);
  });

  it('refuses local tools it cannot check (shell, computer, apply patch) instead of passing them through', () => {
    const shell = shellTool({ shell: { run: async () => ({ output: [] }) } } as any);
    expect(() => guardTools([shell as any])).toThrow(/can't check/);
  });

  it('keeps everything else about the tool; hosted tools pass through with a warning', () => {
    const original = makeTools([]);
    const guarded = guardTools(original);
    expect(guarded.map((t: any) => [t.name, t.parameters])).toEqual(original.map((t: any) => [t.name, t.parameters]));
    expect((guarded[0] as any).invoke).not.toBe((original[0] as any).invoke);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hosted = webSearchTool();
    expect(guardTools([hosted])[0]).toBe(hosted);
    expect(warn.mock.calls.flat().join(' ').toLowerCase()).toContain('not checked');
    warn.mockRestore();
  });
});
