import { describe, it, expect } from 'vitest';
import { validateMcpMessage, isRpcBatch } from '../../src/proxy/http-proxy-security.js';

describe('Protocol Hardening', () => {
  it('rejects batch JSON-RPC arrays', () => {
    expect(isRpcBatch([])).toBe(true);
    expect(isRpcBatch([{ jsonrpc: '2.0' }, { jsonrpc: '2.0' }])).toBe(true);
    expect(isRpcBatch({ jsonrpc: '2.0' })).toBe(false);
  });

  it('rejects empty tool name', () => {
    const msg = { jsonrpc: '2.0', id: '1', method: 'tools/call', params: { name: '', arguments: {} } };
    expect(validateMcpMessage(msg)).toBe('Empty tool name');
  });

  it('rejects missing tool name', () => {
    const msg = { jsonrpc: '2.0', id: '1', method: 'tools/call', params: { arguments: {} } };
    expect(validateMcpMessage(msg)).toBe('Empty tool name');
  });

  it('rejects negative request id', () => {
    const msg = { jsonrpc: '2.0', id: -1, method: 'tools/call', params: { name: 'test', arguments: {} } };
    expect(validateMcpMessage(msg)).toBe('Negative request id not allowed');
  });

  it('rejects NoSQL operators in argument keys', () => {
    const msg = {
      jsonrpc: '2.0', id: '1', method: 'tools/call',
      params: { name: 'read_file', arguments: { path: '/tmp/test.txt', '$gt': '' } },
    };
    expect(validateMcpMessage(msg)).toBe('NoSQL operator in argument key not allowed');
  });

  it('allows valid tool call', () => {
    const msg = {
      jsonrpc: '2.0', id: '1', method: 'tools/call',
      params: { name: 'read_file', arguments: { path: '/tmp/test.txt' } },
    };
    expect(validateMcpMessage(msg)).toBeNull();
  });

  it('rejects missing jsonrpc version', () => {
    const msg = { id: '1', method: 'tools/call', params: { name: 'test', arguments: {} } };
    expect(validateMcpMessage(msg)).toBe('Missing or invalid jsonrpc version');
  });

  it('skips validation for non-tools/call methods', () => {
    expect(validateMcpMessage({ jsonrpc: '2.0', id: '1', method: 'tools/list', params: {} })).toBeNull();
  });
});
