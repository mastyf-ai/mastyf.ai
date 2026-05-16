import { describe, it, expect, beforeEach } from 'vitest';
import { DashboardAuth } from '../../src/auth/dashboard-auth.js';

describe('DashboardAuth', () => {
  beforeEach(() => {
    process.env['DASHBOARD_AUTH_ENABLED'] = 'true';
    process.env['DASHBOARD_API_KEY'] = 'test-secret-key-12345';
    delete process.env['DASHBOARD_JWT_SECRET'];
  });

  it('allows requests when auth disabled', () => {
    const auth = new DashboardAuth({ enabled: false });
    expect(auth.authenticate({ url: '/api/health', method: 'GET' }).authenticated).toBe(true);
  });

  it('authenticates valid API key via query param', () => {
    const auth = new DashboardAuth({ enabled: true, apiKey: 'test-secret-key-12345' });
    const result = auth.authenticate({
      url: '/api/servers?api_key=test-secret-key-12345',
      method: 'GET',
    });
    expect(result.authenticated).toBe(true);
    expect(result.identity).toBe('api_key');
  });

  it('rejects all requests when enabled but credentials missing (fail-closed)', () => {
    delete process.env['DASHBOARD_API_KEY'];
    delete process.env['DASHBOARD_JWT_SECRET'];
    const auth = new DashboardAuth({ enabled: true, apiKey: undefined, jwtSecret: undefined });
    const result = auth.authenticate({ url: '/api/servers', method: 'GET' });
    expect(result.authenticated).toBe(false);
    expect(result.reason).toContain('not configured');
  });

  it('rejects invalid API key', () => {
    const auth = new DashboardAuth({ enabled: true, apiKey: 'test-secret-key-12345' });
    const result = auth.authenticate({
      url: '/api/servers',
      method: 'GET',
      headers: { authorization: 'Bearer wrong-key' },
    });
    expect(result.authenticated).toBe(false);
  });

  it('login via api_key body returns session token', () => {
    const auth = new DashboardAuth({
      enabled: true,
      apiKey: 'test-secret-key-12345',
      jwtSecret: 'jwt-secret-for-sessions',
    });
    const login = auth.login({ body: { api_key: 'test-secret-key-12345' }, ip: '127.0.0.1' });
    expect(login.success).toBe(true);
    expect(login.token).toBeTruthy();

    const session = auth.authenticate({
      url: '/api/servers',
      method: 'GET',
      headers: { authorization: `Bearer ${login.token}` },
    });
    expect(session.authenticated).toBe(true);
    expect(session.identity).toBe('session');
  });

  it('issues new session on each login and revokes prior session', () => {
    process.env['DASHBOARD_USERNAME'] = 'admin';
    process.env['DASHBOARD_PASSWORD'] = 'secret';
    const auth = new DashboardAuth({
      enabled: true,
      jwtSecret: 'jwt-secret-for-sessions',
      allowedOrigins: ['http://localhost:4000'],
    });

    const first = auth.login({
      body: { username: 'admin', password: 'secret' },
      ip: '127.0.0.1',
    });
    expect(first.success).toBe(true);

    const second = auth.login({
      body: { username: 'admin', password: 'secret' },
      ip: '127.0.0.1',
      existingSessionToken: first.token,
    });
    expect(second.success).toBe(true);
    expect(second.token).not.toBe(first.token);

    const oldSession = auth.authenticate({
      url: '/api/health',
      method: 'GET',
      headers: { authorization: `Bearer ${first.token}` },
    });
    expect(oldSession.authenticated).toBe(false);

    const newSession = auth.authenticate({
      url: '/api/health',
      method: 'GET',
      headers: { authorization: `Bearer ${second.token}` },
    });
    expect(newSession.authenticated).toBe(true);

    delete process.env['DASHBOARD_USERNAME'];
    delete process.env['DASHBOARD_PASSWORD'];
  });
});
