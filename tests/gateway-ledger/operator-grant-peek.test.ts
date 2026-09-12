import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  grantMatchesCall,
  peekMatchingAllowGrant,
  shouldBypassPersistShadow,
  type OperatorGrantRow,
} from '../../src/gateway-ledger/operator-grant-peek.js';

function grant(partial: Partial<OperatorGrantRow> & Pick<OperatorGrantRow, 'grant_id' | 'tool_name'>): OperatorGrantRow {
  return {
    remaining_uses: 1,
    expires_at: Date.now() / 1000 + 3600,
    scope: 'once',
    server_name: 'filesystem',
    ...partial,
  };
}

describe('operator grant peek', () => {
  it('matches a unused allow_once grant for the same tool and server', () => {
    const g = grant({ grant_id: 'grant_a', tool_name: 'read_file' });
    expect(
      peekMatchingAllowGrant(
        { toolName: 'read_file', serverName: 'filesystem', serverId: 'filesystem' },
        { grants: [g] },
      )?.grant_id,
    ).toBe('grant_a');
  });

  it('does not match a different tool or exhausted/expired grant', () => {
    const wrongTool = grant({ grant_id: 'grant_b', tool_name: 'write_file' });
    const exhausted = grant({ grant_id: 'grant_c', tool_name: 'read_file', remaining_uses: 0 });
    const expired = grant({
      grant_id: 'grant_d',
      tool_name: 'read_file',
      expires_at: Date.now() / 1000 - 10,
    });
    const deny = grant({ grant_id: 'grant_e', tool_name: 'read_file', scope: 'block' });
    expect(
      peekMatchingAllowGrant(
        { toolName: 'read_file', serverName: 'filesystem' },
        { grants: [wrongTool, exhausted, expired, deny] },
      ),
    ).toBeNull();
  });

  it('does not consume — two peeks return the same grant', () => {
    const g = grant({ grant_id: 'grant_once', tool_name: 'execute_command' });
    const first = peekMatchingAllowGrant({ toolName: 'execute_command', serverName: 'filesystem' }, { grants: [g] });
    const second = peekMatchingAllowGrant({ toolName: 'execute_command', serverName: 'filesystem' }, { grants: [g] });
    expect(first?.grant_id).toBe('grant_once');
    expect(second?.grant_id).toBe('grant_once');
    expect(g.remaining_uses).toBe(1);
  });

  it('reads operator_grants.jsonl from MASTYF_HOME', () => {
    const home = mkdtempSync(join(tmpdir(), 'mastyf-grant-peek-'));
    writeFileSync(
      join(home, 'operator_grants.jsonl'),
      `${JSON.stringify({
        grant_id: 'grant_file',
        tool_name: 'list_directory',
        server_name: 'filesystem',
        remaining_uses: 1,
        expires_at: Date.now() / 1000 + 3600,
        scope: 'once',
      })}\n`,
    );
    expect(
      peekMatchingAllowGrant(
        { toolName: 'list_directory', serverName: 'filesystem' },
        { home },
      )?.grant_id,
    ).toBe('grant_file');
  });

  it('bypasses persist shadow only when a matching unused grant exists', () => {
    const g = grant({ grant_id: 'grant_shadow', tool_name: 'read_file' });
    expect(
      shouldBypassPersistShadow(
        { toolName: 'read_file', serverName: 'filesystem' },
        { grants: [g] },
      ),
    ).toBe(true);
    expect(
      shouldBypassPersistShadow(
        { toolName: 'read_file', serverName: 'filesystem' },
        { grants: [] },
      ),
    ).toBe(false);
  });

  it('tool-scope matches tool name only', () => {
    const g = grant({ grant_id: 'grant_tool', tool_name: 'read_file', scope: 'tool', server_name: 'other' });
    expect(grantMatchesCall(g, { toolName: 'read_file', serverName: 'filesystem' })).toBe(true);
    expect(grantMatchesCall(g, { toolName: 'write_file', serverName: 'filesystem' })).toBe(false);
  });
});
