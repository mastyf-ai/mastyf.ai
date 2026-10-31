import { randomUUID } from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { generateApiKey } from './api-keys';
import { getDefaultPolicyYaml } from './default-policy';
import { evictApiKeysForOrg } from './org-context';
import { getDb } from './db';
import {
  apiKeys,
  organizationMembers,
  organizations,
  policies,
} from './db/schema';
import { suggestTenantSlug, withSlugSuffix } from './tenant-slug';

export type ProvisionResult = {
  orgId: string;
  slug: string;
  apiKeyPlaintext: string;
};

async function uniqueSlug(email: string, name?: string | null): Promise<string> {
  let candidate = suggestTenantSlug(email, name);
  for (let i = 0; i < 20; i++) {
    const slug = i === 0 ? candidate : withSlugSuffix(candidate.replace(/-[a-z0-9]{6}$/, ''), i);
    const existing = await getDb().query.organizations.findFirst({
      where: eq(organizations.slug, slug),
    });
    if (!existing) return slug;
  }
  return suggestTenantSlug(email, `${name ?? 'org'}-${Date.now()}`);
}

export async function provisionFreeOrganization(input: {
  userId: string;
  email: string;
  name?: string | null;
}): Promise<ProvisionResult> {
  const existingMember = await getDb().query.organizationMembers.findFirst({
    where: eq(organizationMembers.userId, input.userId),
  });
  if (existingMember) {
    const org = await getDb().query.organizations.findFirst({
      where: eq(organizations.id, existingMember.orgId),
    });
    if (!org) throw new Error('Organization missing for member');

    const activeKey = await getDb().query.apiKeys.findFirst({
      where: and(eq(apiKeys.orgId, existingMember.orgId), isNull(apiKeys.revokedAt)),
    });

    return {
      orgId: existingMember.orgId,
      slug: org.slug,
      apiKeyPlaintext: activeKey ? '(existing — rotate in settings if needed)' : '',
    };
  }

  const orgId = randomUUID();
  const slug = await uniqueSlug(input.email, input.name);
  const orgName = input.name?.trim() || slug;
  const { plaintext, prefix, hash, hashScheme } = generateApiKey();

  await getDb().transaction(async (tx) => {
    await tx.insert(organizations).values({
      id: orgId,
      slug,
      name: orgName,
      ownerUserId: input.userId,
    });

    await tx.insert(organizationMembers).values({
      orgId,
      userId: input.userId,
      role: 'owner',
    });

    await tx.insert(apiKeys).values({
      id: randomUUID(),
      orgId,
      keyHash: hash,
      hashScheme,
      prefix,
      name: 'default',
    });

    await tx.insert(policies).values({
      id: randomUUID(),
      orgId,
      yamlContent: getDefaultPolicyYaml(),
      version: 1,
    });
  });

  return { orgId, slug, apiKeyPlaintext: plaintext };
}

export async function revokeOrgApiKeys(orgId: string): Promise<void> {
  await getDb()
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(apiKeys.orgId, orgId));
  evictApiKeysForOrg(orgId);
}
