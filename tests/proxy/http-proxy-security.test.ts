import { describe, it, expect } from 'vitest';
import {
  jsonDepth,
  sanitizeResponseHeaders,
  validateHostHeader,
  validateRequestHeaders,
  validateRequestUrlPath,
  validateResponseHeaders,
} from '../../src/proxy/http-proxy-security.js';

describe('http-proxy-security', () => {
  it('validateRequestUrlPath rejects traversal', () => {
    expect(validateRequestUrlPath('/mcp/../../../etc/passwd')).toMatch(/traversal/i);
  });

  it('validateRequestHeaders rejects CRLF values', () => {
    expect(validateRequestHeaders({ 'x-test': 'a\r\nb' })).toMatch(/header/i);
  });

  it('validateHostHeader rejects CRLF', () => {
    expect(validateHostHeader('evil.com\r\nInjected: 1')).toMatch(/Host/i);
  });

  it('sanitizeResponseHeaders drops injected response lines', () => {
    const safe = sanitizeResponseHeaders({
      'content-type': 'application/json',
      'x-test': 'safe\r\nX-Injected: evil',
    });
    expect(safe['x-injected']).toBeUndefined();
    expect(safe['x-test']).toBeUndefined();
    expect(safe['content-type']).toBe('application/json');
  });

  it('validateResponseHeaders rejects CRLF injection', () => {
    expect(validateResponseHeaders({ 'x-evil': 'a\r\nInjected: 1' })).toEqual({
      ok: false,
      error: expect.stringMatching(/CRLF/i),
    });
    expect(validateResponseHeaders({ 'content-type': 'application/json' })).toEqual({ ok: true });
  });

  it('jsonDepth handles deep nesting without stack overflow', () => {
    let nested: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 500; i++) {
      nested = { child: nested };
    }
    expect(jsonDepth(nested, 0, 32)).toBe(false);
    expect(jsonDepth(nested, 0, 600)).toBe(true);
  });
});
