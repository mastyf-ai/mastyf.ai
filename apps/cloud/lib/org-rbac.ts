export type OrgRole = 'viewer' | 'operator' | 'admin' | 'owner';

const ROLE_RANK: Record<OrgRole, number> = {
  viewer: 0,
  operator: 1,
  admin: 2,
  owner: 3,
};

export function normalizeOrgRole(raw: string): OrgRole | null {
  const r = raw.trim().toLowerCase();
  if (r === 'viewer' || r === 'operator' || r === 'admin' || r === 'owner') return r;
  return null;
}

export function orgRoleAtLeast(actual: OrgRole, required: OrgRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export function userCanReadOrg(membership: { role: string }): boolean {
  const role = normalizeOrgRole(membership.role);
  return role != null && orgRoleAtLeast(role, 'viewer');
}

export function userCanOperateOrg(membership: { role: string }): boolean {
  const role = normalizeOrgRole(membership.role);
  return role != null && orgRoleAtLeast(role, 'operator');
}

export function userCanManageOrg(membership: { role: string }): boolean {
  const role = normalizeOrgRole(membership.role);
  return role != null && orgRoleAtLeast(role, 'admin');
}

export type ApiScope =
  | 'badge:read'
  | 'deep-scan:run'
  | 'policy:read'
  | 'policy:write'
  | 'keys:manage'
  | 'laya:classify';

const ALLOWED_API_SCOPES: readonly ApiScope[] = [
  'badge:read',
  'deep-scan:run',
  'policy:read',
  'policy:write',
  'keys:manage',
  'laya:classify',
];

const DEFAULT_API_SCOPES: ApiScope[] = ['badge:read', 'policy:read', 'laya:classify'];

export type ParsedApiKeyScopes = {
  scopes: ApiScope[];
  dropped: string[];
};

export function parseApiKeyScopesDetailed(raw: string | null | undefined): ParsedApiKeyScopes {
  if (!raw) {
    return { scopes: [...DEFAULT_API_SCOPES], dropped: [] };
  }
  try {
    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed)) {
      return { scopes: [...DEFAULT_API_SCOPES], dropped: [] };
    }
    const scopes: ApiScope[] = [];
    const dropped: string[] = [];
    for (const entry of parsed) {
      if (typeof entry !== 'string') continue;
      if (ALLOWED_API_SCOPES.includes(entry as ApiScope)) {
        scopes.push(entry as ApiScope);
      } else {
        dropped.push(entry);
      }
    }
    if (dropped.length > 0) {
      console.warn('[org-rbac] dropped unrecognized API key scopes:', dropped);
    }
    return {
      scopes: scopes.length > 0 ? scopes : [...DEFAULT_API_SCOPES],
      dropped,
    };
  } catch {
    return { scopes: [...DEFAULT_API_SCOPES], dropped: [] };
  }
}

export function parseApiKeyScopes(raw: string | null | undefined): ApiScope[] {
  return parseApiKeyScopesDetailed(raw).scopes;
}

export function apiKeyHasScope(scopes: ApiScope[], required: ApiScope): boolean {
  return scopes.includes(required);
}
