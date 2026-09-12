import { describe, it, expect } from 'vitest';
import {
  defaultDashboardAuthDisabled,
  isLoopbackDashboardBind,
  resolveDashboardBindHost,
  shouldRefuseUnauthenticatedDashboardBind,
} from '../../src/utils/dashboard-bind.js';

describe('dashboard bind posture', () => {
  it('treats loopback hosts as laptop-safe', () => {
    expect(isLoopbackDashboardBind('127.0.0.1')).toBe(true);
    expect(isLoopbackDashboardBind('127.0.0.2')).toBe(true);
    expect(isLoopbackDashboardBind('localhost')).toBe(true);
    expect(isLoopbackDashboardBind('::1')).toBe(true);
    expect(isLoopbackDashboardBind('[::1]')).toBe(true);
  });

  it('treats LAN and wildcard binds as shared-host', () => {
    expect(isLoopbackDashboardBind('0.0.0.0')).toBe(false);
    expect(isLoopbackDashboardBind('::')).toBe(false);
    expect(isLoopbackDashboardBind('[::]')).toBe(false);
    expect(isLoopbackDashboardBind('192.168.1.10')).toBe(false);
    expect(isLoopbackDashboardBind('10.0.0.4')).toBe(false);
  });

  it('defaults auth on for every bind, including loopback', () => {
    expect(defaultDashboardAuthDisabled('127.0.0.1')).toBe('false');
    expect(defaultDashboardAuthDisabled('0.0.0.0')).toBe('false');
    expect(defaultDashboardAuthDisabled('192.168.1.10')).toBe('false');
  });

  it('refuses auth-off on any non-loopback bind', () => {
    expect(shouldRefuseUnauthenticatedDashboardBind('127.0.0.1', true)).toBe(false);
    expect(shouldRefuseUnauthenticatedDashboardBind('0.0.0.0', true)).toBe(true);
    expect(shouldRefuseUnauthenticatedDashboardBind('192.168.1.10', true)).toBe(true);
    expect(shouldRefuseUnauthenticatedDashboardBind('0.0.0.0', false)).toBe(false);
  });

  it('resolves empty bind to 127.0.0.1', () => {
    expect(resolveDashboardBindHost('')).toBe('127.0.0.1');
    expect(resolveDashboardBindHost('  ')).toBe('127.0.0.1');
  });
});
