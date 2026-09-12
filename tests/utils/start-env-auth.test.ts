import { afterEach, describe, it, expect } from 'vitest';
import { applyStartEnv } from '../../src/utils/start-env.js';

const KEYS = ['DASHBOARD_BIND', 'DASHBOARD_AUTH_DISABLED'] as const;
const saved: Record<string, string | undefined> = {};

function snapshot(): void {
  for (const k of KEYS) saved[k] = process.env[k];
}

function restore(): void {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

describe('applyStartEnv dashboard auth defaults', () => {
  afterEach(() => {
    restore();
  });

  it('keeps auth on for loopback bind', () => {
    snapshot();
    delete process.env.DASHBOARD_BIND;
    delete process.env.DASHBOARD_AUTH_DISABLED;
    applyStartEnv();
    expect(process.env.DASHBOARD_BIND).toBe('127.0.0.1');
    expect(process.env.DASHBOARD_AUTH_DISABLED).toBe('false');
  });

  it('does not default auth-off when bind is a LAN address', () => {
    snapshot();
    delete process.env.DASHBOARD_AUTH_DISABLED;
    process.env.DASHBOARD_BIND = '192.168.1.10';
    applyStartEnv();
    expect(process.env.DASHBOARD_AUTH_DISABLED).toBe('false');
  });

  it('preserves an explicit auth-off (listen path still refuses non-loopback)', () => {
    snapshot();
    process.env.DASHBOARD_BIND = '0.0.0.0';
    process.env.DASHBOARD_AUTH_DISABLED = 'true';
    applyStartEnv();
    expect(process.env.DASHBOARD_AUTH_DISABLED).toBe('true');
  });
});
