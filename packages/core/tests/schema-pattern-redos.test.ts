import { describe, it, expect } from 'vitest';
import { hasNestedQuantifier, runSchemaScan } from '../src/schema-scanner.js';

describe('hasNestedQuantifier', () => {
  it.each([
    '(a+)*',
    '(a*)+',
    '^(\\w+\\s?)*$',
    '(x+){2,}',
    '((ab)*)+',
    '(ab)*{3}',
    `(${'a'.repeat(500)}+)*`, // long group body: no length cap to slip past
    '(a"b+)*', // a quote inside the group doesn't end the check
  ])('flags %s', (src) => {
    expect(hasNestedQuantifier(src)).toBe(true);
  });

  it.each([
    '^[a-z]+$',
    '(x|y)+',
    '(abc)*',
    '[(a+)*]', // inside a character class these are literals
    '\\(a+\\)*', // escaped parentheses are literals
    '^\\d{3}-\\d{4}$',
    '(?:foo)?bar+',
  ])('does not flag %s', (src) => {
    expect(hasNestedQuantifier(src)).toBe(false);
  });

  it('stays fast on long hostile input', () => {
    const start = Date.now();
    hasNestedQuantifier('"pattern":"('.repeat(50_000));
    expect(Date.now() - start).toBeLessThan(500);
  });
});

describe('schema scan: nested-quantifier patterns', () => {
  const tool = (inputSchema: unknown) => ({ name: 't', description: 'd', inputSchema } as never);
  const flagged = (inputSchema: unknown) =>
    runSchemaScan(tool(inputSchema)).some((i) => i.id === 'MCPG-S-010');

  it('flags a nested-quantifier pattern on a property', () => {
    expect(flagged({ type: 'object', properties: { q: { type: 'string', pattern: '(a+)+$' } } })).toBe(true);
  });

  it('flags a nested-quantifier patternProperties key', () => {
    expect(flagged({ type: 'object', patternProperties: { '^(x*)*$': { type: 'string' } } })).toBe(true);
  });

  it('still flags an evil pattern hidden after thousands of harmless ones', () => {
    const properties: Record<string, unknown> = {};
    for (let i = 0; i < 3000; i++) properties[`p${i}`] = { type: 'string', pattern: '^[a-z]+$' };
    properties['zz'] = { type: 'string', pattern: '(a+)*' };
    expect(flagged({ type: 'object', properties })).toBe(true);
  });

  it('reports a schema nested deeper than the scan limit instead of skipping it', () => {
    let node: Record<string, unknown> = { type: 'string', pattern: '(a+)*' };
    for (let i = 0; i < 80; i++) node = { type: 'object', properties: { n: node } };
    expect(flagged(node)).toBe(true);
  });

  it('does not crash on a patternProperties object with a huge number of keys', () => {
    const patternProperties: Record<string, unknown> = {};
    for (let i = 0; i < 200_000; i++) patternProperties[`^k${i}$`] = {};
    expect(() => runSchemaScan(tool({ type: 'object', patternProperties }))).not.toThrow();
  });

  it('does not flag a normal pattern', () => {
    expect(flagged({ type: 'object', properties: { q: { type: 'string', pattern: '^[a-z0-9-]{1,40}$' } } })).toBe(false);
  });
});
