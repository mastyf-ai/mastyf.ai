import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = {
  orgId: string;
  mode: string;
  endpoint: string | null;
  secretRef: string | null;
  status: string;
};

const state = vi.hoisted(() => ({ row: undefined as Row | undefined }));

vi.mock('@/lib/db', () => ({
  getDb: () => ({
    query: {
      layaDeployments: {
        findFirst: async () => state.row,
      },
    },
  }),
}));

import { resolveLayaTarget } from '../lib/laya/deployment';

const SHARED = 'https://laya-origin.mastyf.ai/v1/systemone';

function row(partial: Partial<Row>): Row {
  return { orgId: 'org-1', mode: 'shared', endpoint: null, secretRef: null, status: 'active', ...partial };
}

describe('resolveLayaTarget', () => {
  beforeEach(() => {
    state.row = undefined;
    vi.stubEnv('LAYA_SHARED_URL', SHARED);
    vi.stubEnv('LAYA_SHARED_SECRET', 's');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('no row means the shared server', async () => {
    expect(await resolveLayaTarget('org-1')).toEqual({ kind: 'remote', endpoint: SHARED, secret: 's' });
  });

  it('a shared-mode row also means the shared server', async () => {
    state.row = row({ mode: 'shared' });
    expect(await resolveLayaTarget('org-1')).toEqual({ kind: 'remote', endpoint: SHARED, secret: 's' });
  });

  it('an active dedicated row uses its own endpoint and secret', async () => {
    vi.stubEnv('LAYA_SECRET_ACME', 'a');
    state.row = row({ mode: 'dedicated', endpoint: 'https://acme.example/v1/systemone', secretRef: 'LAYA_SECRET_ACME' });
    expect(await resolveLayaTarget('org-1')).toEqual({
      kind: 'remote',
      endpoint: 'https://acme.example/v1/systemone',
      secret: 'a',
    });
  });

  it('self-hosted is reported as such', async () => {
    state.row = row({ mode: 'self_hosted' });
    expect(await resolveLayaTarget('org-1')).toEqual({ kind: 'self_hosted' });
  });

  it.each(['suspended', 'provisioning'])('a %s dedicated row is unavailable', async (status) => {
    vi.stubEnv('LAYA_SECRET_ACME', 'a');
    state.row = row({
      mode: 'dedicated',
      endpoint: 'https://acme.example/v1/systemone',
      secretRef: 'LAYA_SECRET_ACME',
      status,
    });
    expect(await resolveLayaTarget('org-1')).toEqual({ kind: 'unavailable' });
  });

  it('a dedicated row whose secret is empty or unset is unavailable', async () => {
    state.row = row({ mode: 'dedicated', endpoint: 'https://acme.example/v1/systemone', secretRef: 'LAYA_SECRET_NONE' });
    expect(await resolveLayaTarget('org-1')).toEqual({ kind: 'unavailable' });
    vi.stubEnv('LAYA_SECRET_NONE', '');
    expect(await resolveLayaTarget('org-1')).toEqual({ kind: 'unavailable' });
  });

  describe('refuses unsafe rows', () => {
    it.each([
      ['a non-Laya variable', 'AUTH_SECRET', 'https://acme.example/v1/systemone'],
      ['a lower-case ref', 'laya_secret_x', 'https://acme.example/v1/systemone'],
      ['plain http', 'LAYA_SECRET_ACME', 'http://acme.example/v1/systemone'],
    ])('%s', async (_name, secretRef, endpoint) => {
      vi.stubEnv('LAYA_SECRET_ACME', 'a');
      vi.stubEnv('AUTH_SECRET', 'do-not-read');
      // process.env refuses getters, so watch reads through a proxy for the duration of the call.
      const original = process.env;
      const reads: PropertyKey[] = [];
      process.env = new Proxy(original, {
        get(target, key) {
          reads.push(key);
          return Reflect.get(target, key);
        },
      });
      try {
        state.row = row({ mode: 'dedicated', endpoint, secretRef });
        expect(await resolveLayaTarget('org-1')).toEqual({ kind: 'unavailable' });
      } finally {
        process.env = original;
      }
      expect(reads).not.toContain(secretRef);
    });
  });

  describe('shared without config is unavailable', () => {
    it('without a URL', async () => {
      vi.stubEnv('LAYA_SHARED_URL', '');
      expect(await resolveLayaTarget('org-1')).toEqual({ kind: 'unavailable' });
    });

    it('without a secret', async () => {
      vi.stubEnv('LAYA_SHARED_SECRET', '');
      expect(await resolveLayaTarget('org-1')).toEqual({ kind: 'unavailable' });
    });

    it('with a non-https URL', async () => {
      vi.stubEnv('LAYA_SHARED_URL', 'http://laya-origin.mastyf.ai/v1/systemone');
      expect(await resolveLayaTarget('org-1')).toEqual({ kind: 'unavailable' });
    });

    it('allows a local http server outside production', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      for (const url of ['http://127.0.0.1:8077/v1/systemone', 'http://localhost:8077/v1/systemone']) {
        vi.stubEnv('LAYA_SHARED_URL', url);
        expect(await resolveLayaTarget('org-1')).toEqual({ kind: 'remote', endpoint: url, secret: 's' });
      }
    });

    it('refuses a local http server in production', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('LAYA_SHARED_URL', 'http://127.0.0.1:8077/v1/systemone');
      expect(await resolveLayaTarget('org-1')).toEqual({ kind: 'unavailable' });
    });

    it('refuses a look-alike host that only starts with localhost', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('LAYA_SHARED_URL', 'http://localhost.evil.example/v1/systemone');
      expect(await resolveLayaTarget('org-1')).toEqual({ kind: 'unavailable' });
    });
  });
});
