import bcrypt from 'bcryptjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = {
  id: string;
  orgId: string;
  keyHash: string;
  hashScheme: string;
  prefix: string;
  scopes: string;
  revokedAt: Date | null;
};

const state = vi.hoisted(() => ({ rows: [] as Row[], selects: 0 }));

// Conditions are recorded as plain objects so the fake table can answer "where prefix = ?".
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (column: { name: string }, value: unknown) => ({ op: 'eq', column: column.name, value }),
    isNull: (column: { name: string }) => ({ op: 'isNull', column: column.name }),
    and: (...conditions: unknown[]) => ({ op: 'and', conditions }),
  };
});

type Cond = { op: string; column?: string; value?: unknown; conditions?: Cond[] };
function matches(row: Row, cond: Cond): boolean {
  if (cond.op === 'and') return (cond.conditions ?? []).every((c) => matches(row, c));
  if (cond.op === 'isNull') return cond.column === 'revoked_at' ? row.revokedAt === null : true;
  if (cond.op === 'eq' && cond.column === 'prefix') return row.prefix === cond.value;
  if (cond.op === 'eq' && cond.column === 'id') return row.id === cond.value;
  return true;
}

vi.mock('@/lib/db', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: async (cond: Cond) => {
          state.selects++;
          return state.rows.filter((r) => matches(r, cond));
        },
      }),
    }),
    query: {
      organizations: {
        findFirst: async () => ({ id: 'org-1', slug: 'acme', name: 'Acme' }),
      },
    },
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }),
}));

import * as apiKeyLib from '../lib/api-keys';
import { generateApiKey } from '../lib/api-keys';
import {
  evictApiKeysForOrg,
  resetApiKeyCacheForTests,
  resolveOrgFromApiKey,
} from '../lib/org-context';

function rowFor(
  key: { plaintext: string; prefix: string; hash: string },
  scheme = 'sha256',
  orgId = 'org-1',
): Row {
  return {
    id: `id-${key.prefix}-${Math.random()}`,
    orgId,
    keyHash: key.hash,
    hashScheme: scheme,
    prefix: key.prefix,
    scopes: '["badge:read","laya:classify"]',
    revokedAt: null,
  };
}

describe('resolveOrgFromApiKey', () => {
  beforeEach(() => {
    state.rows = [];
    state.selects = 0;
    resetApiKeyCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('rejects a malformed key without touching the database', async () => {
    expect(await resolveOrgFromApiKey('gcp_bad')).toBeNull();
    expect(state.selects).toBe(0);
  });

  it('verifies at most one stored key per request', async () => {
    const key = generateApiKey();
    state.rows = Array.from({ length: 49 }, () => rowFor(generateApiKey()));
    state.rows.push(rowFor(key));
    const verify = vi.spyOn(apiKeyLib, 'verifyApiKey');

    const out = await resolveOrgFromApiKey(key.plaintext);

    expect(out?.org.id).toBe('org-1');
    expect(out?.scopes).toContain('laya:classify');
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('skips the hash check on a repeat request for 60 s', async () => {
    vi.useFakeTimers();
    const key = generateApiKey();
    state.rows = [rowFor(key)];
    const verify = vi.spyOn(apiKeyLib, 'verifyApiKey');

    await resolveOrgFromApiKey(key.plaintext);
    expect(await resolveOrgFromApiKey(key.plaintext)).not.toBeNull();
    expect(verify).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(61_000);
    await resolveOrgFromApiKey(key.plaintext);
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it('rejects a cached key as soon as it is revoked, even by another server', async () => {
    const key = generateApiKey();
    state.rows = [rowFor(key)];
    expect(await resolveOrgFromApiKey(key.plaintext)).not.toBeNull();

    state.rows[0].revokedAt = new Date(); // no evictApiKeysForOrg: revoked elsewhere

    expect(await resolveOrgFromApiKey(key.plaintext)).toBeNull();
    state.rows[0].revokedAt = null;
    expect(await resolveOrgFromApiKey(key.plaintext)).not.toBeNull(); // looked up afresh
  });

  it('uses the current scopes of a cached key', async () => {
    const key = generateApiKey();
    state.rows = [rowFor(key)];
    expect((await resolveOrgFromApiKey(key.plaintext))?.scopes).toContain('laya:classify');

    state.rows[0].scopes = '["badge:read"]';

    expect((await resolveOrgFromApiKey(key.plaintext))?.scopes).toEqual(['badge:read']);
  });

  it("stops accepting a workspace's keys once evicted", async () => {
    const key = generateApiKey();
    state.rows = [rowFor(key)];
    expect(await resolveOrgFromApiKey(key.plaintext)).not.toBeNull();

    state.rows[0].revokedAt = new Date();
    evictApiKeysForOrg('org-1');

    expect(await resolveOrgFromApiKey(key.plaintext)).toBeNull();
  });

  it('keeps other workspaces cached when one is evicted', async () => {
    const key = generateApiKey();
    state.rows = [rowFor(key, 'sha256', 'org-2')];
    const verify = vi.spyOn(apiKeyLib, 'verifyApiKey');
    await resolveOrgFromApiKey(key.plaintext);
    evictApiKeysForOrg('org-1');
    await resolveOrgFromApiKey(key.plaintext);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('accepts legacy bcrypt rows and sha256 rows', async () => {
    const legacy = generateApiKey();
    const fresh = generateApiKey();
    state.rows = [
      rowFor({ ...legacy, hash: bcrypt.hashSync(legacy.plaintext, 4) }, 'bcrypt'),
      rowFor(fresh, 'sha256'),
    ];
    expect(await resolveOrgFromApiKey(legacy.plaintext)).not.toBeNull();
    expect(await resolveOrgFromApiKey(fresh.plaintext)).not.toBeNull();
  });

  it('rejects an unknown well-formed key', async () => {
    state.rows = [rowFor(generateApiKey())];
    expect(await resolveOrgFromApiKey(generateApiKey().plaintext)).toBeNull();
  });
});
