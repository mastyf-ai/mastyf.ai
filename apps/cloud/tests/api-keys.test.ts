import bcrypt from 'bcryptjs';
import { describe, expect, it, vi } from 'vitest';
import {
  extractBearerToken,
  generateApiKey,
  hashApiKey,
  isWellFormedApiKey,
  verifyApiKey,
} from '../lib/api-keys';

const { update, evictApiKeysForOrg } = vi.hoisted(() => ({
  update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
  evictApiKeysForOrg: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ getDb: () => ({ update }) }));
vi.mock('@/lib/org-context', () => ({ evictApiKeysForOrg }));

import { revokeOrgApiKeys } from '../lib/provision';

describe('api-keys', () => {
  it('generates gcp_ prefixed keys', () => {
    const key = generateApiKey();
    expect(key.plaintext.startsWith('gcp_')).toBe(true);
    expect(verifyApiKey(key.plaintext, key.hash, key.hashScheme)).toBe(true);
  });

  it('hashes and verifies', () => {
    const hash = hashApiKey('gcp_test_secret_value_here_1234567890');
    expect(verifyApiKey('gcp_test_secret_value_here_1234567890', hash, 'sha256')).toBe(true);
    expect(verifyApiKey('gcp_wrong', hash, 'sha256')).toBe(false);
  });

  it('hashes new keys with sha256 and verifies both schemes', () => {
    const k = generateApiKey();
    expect(k.hashScheme).toBe('sha256');
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyApiKey(k.plaintext, k.hash, 'sha256')).toBe(true);
    expect(verifyApiKey(k.plaintext + 'x', k.hash, 'sha256')).toBe(false);
    const legacy = bcrypt.hashSync(k.plaintext, 4);
    expect(verifyApiKey(k.plaintext, legacy, 'bcrypt')).toBe(true);
  });

  it('recognises well-formed keys only', () => {
    expect(isWellFormedApiKey(generateApiKey().plaintext)).toBe(true);
    for (const bad of ['', 'gcp_', 'gcp_short', 'xyz_' + 'a'.repeat(43), 'gcp_' + 'a'.repeat(44)])
      expect(isWellFormedApiKey(bad)).toBe(false);
  });

  it("revoking a workspace's keys evicts them from the key cache", async () => {
    await revokeOrgApiKeys('org-1');
    expect(update).toHaveBeenCalled();
    expect(evictApiKeysForOrg).toHaveBeenCalledWith('org-1');
  });

  it('extracts bearer token', () => {
    expect(extractBearerToken('Bearer gcp_abc123')).toBe('gcp_abc123');
    expect(extractBearerToken('Bearer not_our_prefix')).toBeNull();
  });
});
