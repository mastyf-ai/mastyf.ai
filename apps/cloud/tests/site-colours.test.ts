import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const file = (name: string) => readFileSync(join(process.cwd(), name), 'utf8');
const [dark, light] = file('app/design/tokens.css').split(":root[data-theme='light']");

describe('the website’s colours match the app', () => {
  it.each([
    ['--bg', '#0a0a0b'],
    ['--surface', '#151518'],
    ['--line', '#26262a'],
    ['--accent', '#e5cb6c'],
    ['--accent-hover', '#edd98e'],
    ['--frame-bg', '#e5cb6c'],
    ['--frame-ink', '#0a0a0b'],
  ])('dark: %s is %s', (name, value) => {
    expect(dark).toContain(`${name}: ${value};`);
  });

  it.each([
    ['--bg', '#f7f2ec'],
    ['--surface', '#ffffff'],
    ['--line', '#eee5d9'],
    ['--accent', '#603d20'],
    ['--accent-hover', '#4a2e17'],
    ['--accent-ink', '#ffffff'],
    ['--frame-bg', '#e4d7c5'],
    ['--frame-ink', '#2b1f14'],
  ])('light: %s is %s', (name, value) => {
    expect(light).toContain(`${name}: ${value};`);
  });

  it('puts the navbar and dashboard sidebar on the app’s frame colour', () => {
    expect(file('app/design/shell.css')).toMatch(/\.nav__bar \{[^}]*background: var\(--frame-bg\)/);
    expect(file('app/design/app.css')).toMatch(/\.app__side \{[^}]*background: var\(--frame-bg\)/);
  });
});
