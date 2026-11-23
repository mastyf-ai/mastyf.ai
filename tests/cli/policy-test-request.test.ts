import { describe, expect, it } from 'vitest';
import { policyTestRequest } from '../../src/cli/policy-test-request.js';

describe('POST /api/policy/test body', () => {
  it('reads `arguments` / `mode` (dashboard) and `args` / `blockingMode` (older middlewares) alike', () => {
    const current = policyTestRequest({ tool: 't', arguments: { path: '/x' }, mode: 'block' }, 'p.yaml');
    const older = policyTestRequest({ tool: 't', args: { path: '/x' }, blockingMode: 'block' }, 'p.yaml');
    expect(current).toEqual(older);
    expect(JSON.parse(current.args)).toEqual({ path: '/x' });
    expect(current.blockingMode).toBe('block');
    expect(current.policy).toBe('p.yaml');
  });

  it('prefers `arguments` when both are sent', () => {
    expect(JSON.parse(policyTestRequest({ arguments: { a: 1 }, args: { b: 2 } }, 'p').args)).toEqual({ a: 1 });
  });

  it('defaults to empty arguments, the given policy and no mode', () => {
    expect(policyTestRequest({ tool: 't', arguments: 'not-an-object' }, 'p.yaml')).toMatchObject({
      args: '{}',
      server: 'dashboard-test',
      blockingMode: undefined,
    });
  });
});

describe('POST /api/policy/test: dry runs and tool results', () => {
  it('only treats an explicit dryRun: true as a dry run', () => {
    expect(policyTestRequest({ tool: 't', dryRun: true }, 'p').dryRun).toBe(true);
    expect(policyTestRequest({ tool: 't', dryRun: 'true' }, 'p').dryRun).toBe(false);
    expect(policyTestRequest({ tool: 't' }, 'p').dryRun).toBe(false);
  });

  it('reads a tool result as text and caps its size', () => {
    expect(policyTestRequest({ tool: 't', result: 'hello' }, 'p').result).toBe('hello');
    expect(policyTestRequest({ tool: 't', result: { not: 'text' } }, 'p').result).toBeUndefined();
    expect(policyTestRequest({ tool: 't', result: 'x'.repeat(70_000) }, 'p').result).toHaveLength(64_000);
  });
});
