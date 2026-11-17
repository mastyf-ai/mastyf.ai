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
    const blocks = [...readme.matchAll(/```ya?ml\n([\s\S]*?)```/g)].map((m) => m[1]!);
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    for (const b of blocks) expect(() => parse(b)).not.toThrow();
  });

  it('documents every input with its default, and every output', () => {
    for (const [name, spec] of Object.entries(action.inputs) as [string, { default: string }][]) {
      const row = readme.split('\n').find((l) => l.startsWith(`| \`${name}\``));
      expect(row, name).toBeDefined();
      expect(row, name).toContain(spec.default === '' ? '(built-in free policy)' : `\`${spec.default}\``);
    }
    for (const name of Object.keys(action.outputs)) expect(readme).toContain(`\`${name}\``);
  });

  it('says what matters to someone deciding to use it', () => {
    expect(readme).toContain('nothing is sent to Mastyf');
    expect(readme).toMatch(/container jobs aren't supported yet/i);
    expect(readme).toContain('v2.327.1');
    expect(readme).toContain('https://www.mastyf.ai');
  });
});
