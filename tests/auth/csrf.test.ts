import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DashboardAuth, CSRF_COOKIE_NAME } from '../../src/auth/dashboard-auth.js';

function csrfHeaders(token: string, origin = 'http://localhost:4000') {
  return {
    origin,
    cookie: `${CSRF_COOKIE_NAME}=${token}`,
    'x-csrf-token': token,
  };
}

describe('DashboardAuth CSRF', () => {
  const savedDisabled = process.env['DASHBOARD_AUTH_DISABLED'];

  beforeEach(() => {
    delete process.env['DASHBOARD_AUTH_DISABLED'];
    process.env['DASHBOARD_AUTH_ENABLED'] = 'true';
  });

  afterEach(() => {
    if (savedDisabled === undefined) delete process.env['DASHBOARD_AUTH_DISABLED'];
    else process.env['DASHBOARD_AUTH_DISABLED'] = savedDisabled;
  });

  it('skips CSRF when auth disabled', () => {
    const auth = new DashboardAuth({ enabled: false });
    expect(auth.isCsrfEnforced()).toBe(false);
    const result = auth.authenticate({ url: '/api/policy', method: 'POST', headers: {} });
    expect(result.authenticated).toBe(true);
  });

  it('accepts API-key POST without CSRF (machine clients / Next rewrite)', () => {
    const auth = new DashboardAuth({
      enabled: true,
      apiKey: 'test-key',
      allowedOrigins: ['http://localhost:4000'],
    });
    const result = auth.authenticate({
      url: '/api/policy',
      method: 'POST',
      headers: { authorization: 'Bearer test-key', origin: 'http://localhost:4000' },
    });
    expect(result.authenticated).toBe(true);
    expect(result.identity).toBe('api_key');
  });

  it('rejects cookie-session POST without CSRF when auth enabled', () => {
    const auth = new DashboardAuth({
      enabled: true,
      apiKey: 'test-key',
      jwtSecret: 'jwt-secret-for-csrf-test',
      allowedOrigins: ['http://localhost:4000'],
    });
    const login = auth.login({
      body: { api_key: 'test-key' },
      headers: { origin: 'http://localhost:4000' },
      ip: '127.0.0.1',
    });
    expect(login.success).toBe(true);
    const result = auth.authenticate({
      url: '/api/policy',
      method: 'POST',
      headers: {
        cookie: `mastyf_ai_session=${login.token}`,
        origin: 'http://localhost:4000',
      },
    });
    expect(result.authenticated).toBe(false);
    expect(result.reason).toContain('CSRF');
  });

  it('accepts POST with matching CSRF cookie and header', () => {
    const auth = new DashboardAuth({
      enabled: true,
      apiKey: 'test-key',
      allowedOrigins: ['http://localhost:4000'],
    });
    const token = auth.issueCsrfToken();
    const result = auth.authenticate({
      url: '/api/policy',
      method: 'POST',
      headers: {
        authorization: 'Bearer test-key',
        ...csrfHeaders(token),
      },
    });
    expect(result.authenticated).toBe(true);
  });

  it('rejects cookie-session POST from a disallowed Origin', () => {
    const auth = new DashboardAuth({
      enabled: true,
      apiKey: 'test-key',
      jwtSecret: 'jwt-secret-for-csrf-test',
      allowedOrigins: ['http://localhost:4000'],
    });
    const login = auth.login({
      body: { api_key: 'test-key' },
      headers: { origin: 'http://localhost:4000' },
      ip: '127.0.0.1',
    });
    expect(login.success).toBe(true);
    const token = auth.issueCsrfToken();
    const result = auth.authenticate({
      url: '/api/policy',
      method: 'POST',
      headers: {
        cookie: `mastyf_ai_session=${login.token}; ${CSRF_COOKIE_NAME}=${token}`,
        'x-csrf-token': token,
        origin: 'https://evil.example',
      },
    });
    expect(result.authenticated).toBe(false);
    expect(result.reason).toContain('Origin');
  });
});
