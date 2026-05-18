import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OAuthValidator } from '../../src/auth/oauth.js';

describe('OAuthValidator.extractAuthFromMcpMessage', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('reads Authorization from JSON-RPC root', () => {
    const header = OAuthValidator.extractAuthFromMcpMessage({
      jsonrpc: '2.0',
      Authorization: 'Bearer root-token',
      method: 'tools/call',
    });
    expect(header).toBe('Bearer root-token');
    expect(OAuthValidator.extractToken(header)).toBe('root-token');
  });

  it('reads token from params._meta.auth', () => {
    const header = OAuthValidator.extractAuthFromMcpMessage({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        _meta: { auth: { Authorization: 'Bearer meta-token' } },
      },
    });
    expect(OAuthValidator.extractToken(header)).toBe('meta-token');
  });

  it('reads access_token from params._meta.auth', () => {
    const header = OAuthValidator.extractAuthFromMcpMessage({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { _meta: { auth: { access_token: 'at-123' } } },
    });
    expect(header).toBe('Bearer at-123');
  });

  it('reads Authorization from initialize clientInfo headers', () => {
    const header = OAuthValidator.extractAuthFromMcpMessage({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        clientInfo: { headers: { Authorization: 'Bearer init-token' } },
      },
    });
    expect(OAuthValidator.extractToken(header)).toBe('init-token');
  });

  it('falls back to MCP_GUARDIAN_BEARER_TOKEN env', () => {
    process.env.MCP_GUARDIAN_BEARER_TOKEN = 'env-secret';
    const header = OAuthValidator.extractAuthFromMcpMessage({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {},
    });
    expect(OAuthValidator.extractToken(header)).toBe('env-secret');
  });
});
