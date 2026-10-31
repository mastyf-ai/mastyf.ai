import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from './db';
import {
  apiKeys,
  organizationMembers,
  organizations,
  policies,
} from './db/schema';
import { hashApiKey, isWellFormedApiKey, verifyApiKey, type ApiKeyHashScheme } from './api-keys';
import { userCanManageOrg as rbacCanManage, parseApiKeyScopesDetailed, type ApiScope } from './org-rbac';

export type UserOrgContext = {
  org: typeof organizations.$inferSelect;
  membership: typeof organizationMembers.$inferSelect;
  policy: typeof policies.$inferSelect | null;
};

export async function getUserOrg(userId: string): Promise<UserOrgContext | null> {
  const membership = await getDb().query.organizationMembers.findFirst({
    where: eq(organizationMembers.userId, userId),
  });
  if (!membership) return null;

  const org = await getDb().query.organizations.findFirst({
    where: eq(organizations.id, membership.orgId),
  });
  if (!org) return null;

  const policy = await getDb().query.policies.findFirst({
    where: eq(policies.orgId, org.id),
  });

  return { org, membership, policy: policy ?? null };
}

/** @deprecated Use getUserOrg — all orgs are active (no subscription gating). */
export async function requireActiveUserOrg(userId: string): Promise<UserOrgContext | null> {
  return getUserOrg(userId);
}

export type ApiKeyOrg = {
  org: typeof organizations.$inferSelect;
  apiKeyId: string;
  scopes: ApiScope[];
};

const API_KEY_CACHE_TTL_MS = 60_000;
const API_KEY_CACHE_MAX = 1_000;

// Verified keys, keyed by the SHA-256 of the key so the plaintext is never held. Only hits are
// cached. The cache spares the hash check and the org lookup, never the revocation check: a hit
// still reads the key's row, so a key revoked or narrowed on another server stops working at once.
const apiKeyCache = new Map<string, { result: ApiKeyOrg; orgId: string; expiresAt: number }>();

export function evictApiKeysForOrg(orgId: string): void {
  for (const [k, entry] of apiKeyCache) {
    if (entry.orgId === orgId) apiKeyCache.delete(k);
  }
}

export function resetApiKeyCacheForTests(): void {
  apiKeyCache.clear();
}

export async function resolveOrgFromApiKey(bearerToken: string): Promise<ApiKeyOrg | null> {
  if (!isWellFormedApiKey(bearerToken)) return null;

  const cacheKey = hashApiKey(bearerToken);
  const cached = apiKeyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    const [live] = await getDb()
      .select({ scopes: apiKeys.scopes })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, cached.result.apiKeyId), isNull(apiKeys.revokedAt)));
    if (!live) {
      apiKeyCache.delete(cacheKey);
      return null;
    }
    return { ...cached.result, scopes: parseApiKeyScopesDetailed(live.scopes).scopes };
  }
  if (cached) apiKeyCache.delete(cacheKey);

  const keys = await getDb()
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.prefix, bearerToken.slice(0, 12)), isNull(apiKeys.revokedAt)));

  for (const row of keys) {
    if (verifyApiKey(bearerToken, row.keyHash, row.hashScheme as ApiKeyHashScheme)) {
      const org = await getDb().query.organizations.findFirst({
        where: eq(organizations.id, row.orgId),
      });
      if (!org) return null;
      await getDb()
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, row.id));
      const result: ApiKeyOrg = {
        org,
        apiKeyId: row.id,
        scopes: parseApiKeyScopesDetailed((row as { scopes?: string }).scopes).scopes,
      };
      if (apiKeyCache.size >= API_KEY_CACHE_MAX) {
        const oldest = apiKeyCache.keys().next().value;
        if (oldest !== undefined) apiKeyCache.delete(oldest);
      }
      apiKeyCache.set(cacheKey, { result, orgId: row.orgId, expiresAt: Date.now() + API_KEY_CACHE_TTL_MS });
      return result;
    }
  }
  return null;
}

export function userCanManageOrg(membership: typeof organizationMembers.$inferSelect): boolean {
  return rbacCanManage(membership);
}
