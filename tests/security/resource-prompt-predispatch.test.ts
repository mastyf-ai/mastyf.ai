/**
 * Pre-dispatch authorization of the target a request names.
 *
 * `applyMcpResponsePipeline` gates what a server returns; these tests cover the
 * request side, where a traversal URI or prompt name must be refused *before* the
 * upstream server sees it. The id-less cases are load-bearing: `id` is optional
 * in the JSON-RPC schema, so a client that omits it must still be blocked rather
 * than forwarded.
 */
import { describe, it, expect, vi } from 'vitest';
import { runMcpPrePipeline } from '../../src/proxy/mcp-request-pipeline.js';
import { Logger } from '../../src/utils/logger.js';

const SERVER = 'pre-dispatch-test';

function run(msg: Record<string, unknown>) {
  return runMcpPrePipeline({ msg, serverName: SERVER, authenticated: true });
}

const TRAVERSAL_URI = 'file:///app/../../etc/passwd';
const LEGITIMATE_URI = 'file:///app/notes.md';

describe('pre-dispatch target authorization', () => {
  it('blocks a traversal resources/read that carries an id, with an error body', () => {
    const r = run({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: TRAVERSAL_URI } });
    expect(r.blocked).toBe(true);
    const body = (r as { response?: { error?: { code?: number } } }).response;
    expect(body?.error?.code).toBe(-32001);
  });

  it('blocks a traversal resources/read that omits its id, and returns no body', () => {
    const r = run({ jsonrpc: '2.0', method: 'resources/read', params: { uri: TRAVERSAL_URI } });
    // `blocked` must mean stop. Before the fix this was forwarded, because the
    // enforcement branch was gated on the request carrying an id.
    expect(r.blocked).toBe(true);
    expect((r as { response?: unknown }).response).toBeUndefined();
  });

  it('blocks a traversing prompt name with and without an id', () => {
    expect(
      run({ jsonrpc: '2.0', id: 2, method: 'prompts/get', params: { name: '../../hidden_prompt' } })
        .blocked,
    ).toBe(true);
    expect(
      run({ jsonrpc: '2.0', method: 'prompts/get', params: { name: '../../hidden_prompt' } }).blocked,
    ).toBe(true);
  });

  it('blocks a literal cloud-metadata and private-network target', () => {
    for (const uri of [
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/internal',
      'https://localhost/secret',
    ]) {
      expect(
        run({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri } }).blocked,
        `expected ${uri} to be blocked`,
      ).toBe(true);
    }
  });

  it('does not over-block legitimate targets', () => {
    for (const [method, params] of [
      ['resources/read', { uri: LEGITIMATE_URI }],
      ['resources/read', { uri: 'postgres://db.corp.internal/tables/metrics' }],
      ['prompts/get', { name: 'summarize-text' }],
    ] as [string, Record<string, unknown>][]) {
      expect(
        run({ jsonrpc: '2.0', id: 4, method, params }).blocked,
        `expected ${method} ${JSON.stringify(params)} to pass`,
      ).toBe(false);
    }
  });

  it('leaves methods that name no target untouched', () => {
    for (const method of ['resources/list', 'tools/list', 'ping']) {
      expect(run({ jsonrpc: '2.0', id: 5, method }).blocked, `expected ${method} to pass`).toBe(
        false,
      );
    }
  });

  it('logs the id-less denial, since no response is returned to the client', () => {
    const spy = vi.spyOn(Logger, 'error').mockImplementation(() => {});
    try {
      run({ jsonrpc: '2.0', method: 'resources/read', params: { uri: TRAVERSAL_URI } });
      const logged = spy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).toMatch(/id-less/);
    } finally {
      spy.mockRestore();
    }
  });

  it('refuses a target-requiring method whose target was omitted', () => {
    // Omitting the target must not be a way to skip authorization. Returning
    // "no verdict" here used to forward the request to the upstream untouched.
    for (const [method, params] of [
      ['resources/read', {}],
      ['resources/read', { uri: '' }],
      ['resources/read', { uri: 42 }],
      ['resources/subscribe', {}],
      ['prompts/get', {}],
      ['prompts/get', { name: '' }],
      ['prompts/get', { name: null }],
    ] as [string, Record<string, unknown>][]) {
      const r = run({ jsonrpc: '2.0', id: 6, method, params });
      expect(r.blocked, `expected ${method} ${JSON.stringify(params)} to be refused`).toBe(true);
      expect(
        (r as { code?: number }).code,
        `expected invalid-params for ${method} ${JSON.stringify(params)}`,
      ).toBe(-32602);
    }
  });

  it('refuses an omitted target even when the request omits its id', () => {
    const r = run({ jsonrpc: '2.0', method: 'resources/read', params: {} });
    expect(r.blocked).toBe(true);
    expect((r as { code?: number }).code).toBe(-32602);
    // No id means no response body is produced.
    expect((r as { response?: unknown }).response).toBeUndefined();
  });
});
