import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { CheckEngine } from '../src/engine';

const CORPUS = join(__dirname, '..', '..', '..', 'corpus');

/** What an agent does on an ordinary day: read and write project files, run git and the test runner, look things up. */
const CALLS: Array<[string, Record<string, unknown>]> = [
  ['read_file', { path: './README.md' }],
  ['read_file', { path: 'src/index.ts' }],
  ['read_file', { path: 'package.json' }],
  ['read_file', { path: 'docs/guide/getting-started.md' }],
  ['read_text_file', { path: './CHANGELOG.md' }],
  ['list_directory', { path: '.' }],
  ['list_directory', { path: 'src' }],
  ['write_file', { path: 'notes/todo.md', content: '- ship the release\n- update the docs' }],
  ['write_file', { path: 'src/util.ts', content: 'export const add = (a: number, b: number) => a + b;' }],
  ['edit_file', { path: 'src/app.ts', old: 'const x = 1', new: 'const x = 2' }],
  ['create_directory', { path: 'build/output' }],
  ['search_files', { pattern: 'TODO', path: 'src' }],
  ['grep', { pattern: 'function main', path: 'src' }],
  ['search', { query: 'how to configure typescript paths' }],
  ['search', { query: 'weather in Mumbai tomorrow' }],
  ['web_search', { query: 'node 22 release notes' }],
  ['fetch', { url: 'https://docs.python.org/3/library/json.html' }],
  ['fetch', { url: 'https://developer.mozilla.org/en-US/docs/Web/API/fetch' }],
  ['fetch_page', { url: 'https://github.com/mastyf-ai/mastyf.ai/blob/main/README.md' }],
  ['bash', { command: 'git status' }],
  ['bash', { command: 'git diff --stat' }],
  ['bash', { command: 'git log --oneline -n 10' }],
  ['bash', { command: 'git add -A && git commit -m "fix: handle empty input"' }],
  ['bash', { command: 'git checkout -b feature/search' }],
  ['bash', { command: 'npm test' }],
  ['bash', { command: 'npm run build && npm run lint' }],
  ['bash', { command: 'pnpm install' }],
  ['bash', { command: 'pytest -q tests/' }],
  ['bash', { command: 'ls -la src && cat package.json' }],
  ['bash', { command: 'cd packages/core && npx vitest run' }],
  ['bash', { command: 'node scripts/build.mjs' }],
  ['bash', { command: 'python -m pytest tests/test_api.py -x' }],
  ['bash', { command: 'grep -rn "TODO" src | head -20' }],
  ['bash', { command: 'docker build -t myapp .' }],
  ['run_command', { command: 'cargo test' }],
  ['run_command', { command: 'go test ./...' }],
  ['run_tests', { path: 'tests/', filter: 'auth' }],
  ['git_commit', { message: 'Add search endpoint' }],
  ['git_diff', { target: 'HEAD~1' }],
  ['create_issue', { title: 'Search is slow on large repos', body: 'Steps to reproduce: index 10k files, run search.' }],
  ['send_message', { channel: 'dev', text: 'Deploy finished, all checks green.' }],
  ['query', { sql: 'SELECT id, name FROM customers WHERE id = 42' }],
  ['calculator', { expression: '12 * (3 + 4)' }],
  ['get_weather', { city: 'Seattle' }],
  ['translate', { text: 'good morning', to: 'hi' }],
];

const RESULTS: Array<[string, unknown]> = [
  ['read_file', 'import express from "express";\nconst app = express();\napp.listen(3000);'],
  ['list_directory', ['README.md', 'package.json', 'src', 'tests']],
  ['search', { results: [{ title: 'TypeScript paths', url: 'https://www.typescriptlang.org/tsconfig#paths' }] }],
  ['fetch_page', { content: 'Release notes for version 2.1: faster startup, fixed a crash when the config file is empty.' }],
  ['bash', { stdout: 'On branch main\nnothing to commit, working tree clean', exitCode: 0 }],
  ['bash', { stdout: 'Tests: 128 passed, 128 total', exitCode: 0 }],
  ['query', { rows: [{ id: 42, name: 'Asha Verma' }] }],
  ['get_weather', { city: 'Seattle', tempC: 11, summary: 'light rain' }],
  ['create_issue', { number: 482, url: 'https://github.com/example/app/issues/482' }],
  ['calculator', { value: 84 }],
];

let engine: CheckEngine;
beforeAll(async () => {
  engine = await CheckEngine.create({});
});

describe('ordinary work is never blocked by the default policy', () => {
  it('has at least 40 hand-written calls', () => expect(CALLS.length).toBeGreaterThanOrEqual(40));

  for (const [tool, args] of CALLS) {
    it(`allows ${tool} ${JSON.stringify(args).slice(0, 70)}`, async () => {
      const v = await engine.checkCall({ tool, arguments: args });
      expect({ decision: v.decision, why: v.rule ? `${v.rule}: ${v.reason}` : undefined }).toEqual({ decision: 'allow', why: undefined });
    });
  }

  for (const [tool, result] of RESULTS) {
    it(`allows a result from ${tool}`, async () => {
      expect((await engine.checkResult({ tool, result })).decision).toBe('allow');
    });
  }

  it('allows every benign call in the repository corpus', async () => {
    const dir = join(CORPUS, 'benign');
    const blocked: string[] = [];
    for (const name of readdirSync(dir)) {
      const entry = JSON.parse(readFileSync(join(dir, name), 'utf8')) as { toolName: string; arguments: Record<string, unknown> };
      const v = await engine.checkCall({ tool: entry.toolName, arguments: entry.arguments });
      if (v.decision !== 'allow') blocked.push(`${name}: ${v.reason}`);
    }
    expect(blocked).toEqual([]);
  });
});
