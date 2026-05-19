import { describe, it, expect } from 'vitest';
import {
  sanitizeResponseHeaders,
  validateHostHeader,
  validateRequestHeaders,
  validateRequestUrlPath,
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
});
