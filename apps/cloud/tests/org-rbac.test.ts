import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  normalizeOrgRole,
  orgRoleAtLeast,
  parseApiKeyScopes,
  parseApiKeyScopesDetailed,
  userCanManageOrg,
  userCanReadOrg,
} from '../lib/org-rbac';

describe('org-rbac', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes known roles', () => {
    expect(normalizeOrgRole('Admin')).toBe('admin');
    expect(normalizeOrgRole('owner')).toBe('owner');
    expect(normalizeOrgRole('unknown')).toBeNull();
  });

  it('ranks roles correctly', () => {
    expect(orgRoleAtLeast('owner', 'admin')).toBe(true);
    expect(orgRoleAtLeast('viewer', 'operator')).toBe(false);
    expect(orgRoleAtLeast('operator', 'operator')).toBe(true);
  });

  it('viewer can read but not manage', () => {
    expect(userCanReadOrg({ role: 'viewer' })).toBe(true);
    expect(userCanManageOrg({ role: 'viewer' })).toBe(false);
  });

  it('admin can manage org', () => {
    expect(userCanManageOrg({ role: 'admin' })).toBe(true);
    expect(userCanManageOrg({ role: 'owner' })).toBe(true);
  });

  it('knows the laya:classify scope and grants it by default', () => {
    expect(parseApiKeyScopesDetailed('["laya:classify"]').scopes).toEqual(['laya:classify']);
    expect(parseApiKeyScopesDetailed(null).scopes).toContain('laya:classify');
  });

  it('filters scopes to allowlist', () => {
    expect(parseApiKeyScopes(JSON.stringify(['policy:read', 'evil:admin']))).toEqual(['policy:read']);
  });

  it('logs and returns dropped scopes from parseApiKeyScopesDetailed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = parseApiKeyScopesDetailed(JSON.stringify(['policy:read', 'removed:scope']));
    expect(result.scopes).toEqual(['policy:read']);
    expect(result.dropped).toEqual(['removed:scope']);
    expect(warn).toHaveBeenCalledWith('[org-rbac] dropped unrecognized API key scopes:', ['removed:scope']);
  });
});
