import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(join(pkg, 'README.md'), 'utf8');
const action = parse(readFileSync(join(pkg, 'action.yml'), 'utf8'));

describe('README', () => {
  it('every YAML example parses', () => {
    const blocks = [...readme.matchAll(/```ya?ml\r?\n([\s\S]*?)```/g)].map((m) => m[1]!);
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    for (const b of blocks) expect(() => parse(b)).not.toThrow();
  });

  it('documents every input with its default, and every output', () => {
    for (const [name, spec] of Object.entries(action.inputs) as [string, { default: string }][]) {
      const row = readme.split('\n').find((l) => l.startsWith(`| \`${name}\``));
      expect(row, name).toBeDefined();
      if (spec.default === '') expect(row, name).toMatch(/^\| `[^`]+` \| \([^)]+\) \|/); // an empty default is described in words
      else expect(row, name).toContain(`\`${spec.default}\``);
    }
    for (const name of Object.keys(action.outputs)) expect(readme).toContain(`\`${name}\``);
  });

  it('says what matters to someone deciding to use it', () => {
    expect(readme).toContain('nothing is sent to Mastyf');
    expect(readme).toMatch(/container jobs aren't supported yet/i);
    expect(readme).toContain('v2.327.1');
    expect(readme).toContain('https://www.mastyf.ai');
  });

  it('explains Claude Code: how to turn it on, its limit, and the version it needs', () => {
    expect(readme).toContain('## Claude Code');
    expect(readme).toContain('settings: ${{ steps.mastyf.outputs.claude-settings }}');
    expect(readme).toContain('anthropics/claude-code-action@v1');
    expect(readme).toMatch(/built-in tool[^.]*can't always be replaced/);
    expect(readme).toContain('v2.1.295');
  });
});
