import { describe, it, expect } from 'vitest';
import { credentialBroker } from '../../src/auth/credential-broker.js';

describe('CredentialBroker', () => {
  it('stores and retrieves a credential', async () => {
    const id = await credentialBroker.storeCredential({
      tenantId: 'default', userId: 'test-user', providerName: 'github',
      providerId: 'github', credentialType: 'bearer_token',
      token: 'ghp_test1234567890', scopes: ['repo', 'read:org'],
    });
    expect(id).toMatch(/^cred_/);

    const cred = await credentialBroker.getCredential('default', 'github', 'bearer_token');
    expect(cred).not.toBeNull();
    if (cred) expect(cred.token).toBe('ghp_test1234567890');
  });

  it('returns null for non-existent credential', async () => {
    const cred = await credentialBroker.getCredential('default', 'nonexistent', 'api_key');
    expect(cred).toBeNull();
  });

  it('injects credential into headers', async () => {
    await credentialBroker.storeCredential({
      tenantId: 'default', userId: 'test-user', providerName: 'github',
      providerId: 'github', credentialType: 'bearer_token',
      token: 'ghp_test123', scopes: [],
    });
    const headers = await credentialBroker.injectCredentialIntoHeaders('default', 'github', 'bearer_token', {
      'Content-Type': 'application/json',
    });
    expect(headers.Authorization).toBe('Bearer ghp_test123');
  });

  it('strips credentials from response', async () => {
    const response = '{"access_token":"sk-abc123","data":"hello","token":"ghp_xyz789"}';
    const cleaned = await credentialBroker.stripCredentialsFromResponse(response);
    expect(cleaned).not.toContain('sk-abc123');
    expect(cleaned).not.toContain('ghp_xyz789');
    expect(cleaned).toContain('"data":"hello"');
  });
});
