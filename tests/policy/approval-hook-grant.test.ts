import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApprovalHook } from '../../src/policy/approval-hook.js';
import type { HookContext } from '../../src/policy/tool-call-hooks.js';
import type { OperatorGrantRow } from '../../src/gateway-ledger/operator-grant-peek.js';

function ctx(toolName: string, serverName = 'filesystem'): HookContext {
  return {
    tool: {
      serverName,
      toolName,
      arguments: { probe: true },
      requestId: 'req-1',
    },
    timestamp: new Date().toISOString(),
    hookState: new Map(),
  };
}

describe('approval hook + operator grant', () => {
  let prevHome: string | undefined;

  beforeEach(() => {
    prevHome = process.env.MASTYF_HOME;
    process.env.MASTYF_HOME = mkdtempSync(join(tmpdir(), 'mastyf-approval-grant-'));
    mkdirSync(process.env.MASTYF_HOME, { recursive: true });
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.MASTYF_HOME;
    else process.env.MASTYF_HOME = prevHome;
  });

  it('allows tools that are not on the approval list', async () => {
    const hook = createApprovalHook({
      matchTools: ['execute_command'],
      approvers: ['admin'],
      timeoutSeconds: 60,
    });
    const result = await hook.beforeToolCall(ctx('read_file'));
    expect(result.allowed).toBe(true);
  });

  it('allows the next matching listed tool when an unused allow-once grant exists', async () => {
    const home = process.env.MASTYF_HOME;
    expect(home).toBeTruthy();
    mkdirSync(home!, { recursive: true });
    const row: OperatorGrantRow = {
      grant_id: 'grant_approval_bypass',
      tool_name: 'execute_command',
      server_name: 'filesystem',
      remaining_uses: 1,
      expires_at: Date.now() / 1000 + 3600,
      scope: 'once',
    };
    writeFileSync(join(home!, 'operator_grants.jsonl'), `${JSON.stringify(row)}\n`);
    const hook = createApprovalHook({
      matchTools: ['execute_command'],
      approvers: ['admin'],
      timeoutSeconds: 60,
    });
    const result = await hook.beforeToolCall(ctx('execute_command'));
    expect(result.allowed).toBe(true);
    expect(result.reason).toMatch(/grant_approval_bypass/);
  });
});
