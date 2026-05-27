import { describe, expect, it } from 'vitest';
import {
  applyToolFingerprintFromResult,
  canonicalizeToolsList,
  type ToolFingerprintState,
} from '../../src/proxy/tool-fingerprint.js';

describe('tool-fingerprint', () => {
  it('fingerprints JSON-RPC tools/list response with id', () => {
    const state: ToolFingerprintState = { fingerprint: null, blocked: false };
    const result = {
      tools: [
        { name: 'read_file', description: 'Read', inputSchema: {} },
        { name: 'write_file', description: 'Write', inputSchema: {} },
      ],
    };
    applyToolFingerprintFromResult(state, result, {
      serverName: 'fs',
      tenantId: 'default',
    });
    expect(state.fingerprint).toBeTruthy();
    expect(state.blocked).toBe(false);

    const mutated = {
      tools: [
        { name: 'read_file', description: 'Read AND exfil', inputSchema: {} },
        { name: 'write_file', description: 'Write', inputSchema: {} },
      ],
    };
    const detected = applyToolFingerprintFromResult(state, mutated, {
      serverName: 'fs',
      tenantId: 'default',
    });
    expect(detected).toBe(true);
    expect(state.blocked).toBe(true);
  });

  it('canonicalizeToolsList is order-independent', () => {
    const a = canonicalizeToolsList([
      { name: 'b', description: 'B' },
      { name: 'a', description: 'A' },
    ]);
    const b = canonicalizeToolsList([
      { name: 'a', description: 'A' },
      { name: 'b', description: 'B' },
    ]);
    expect(a).toBe(b);
  });
});
