import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  buildPackageMcpConfig,
  isValidNpmPackageName,
} from '../../src/agentic/trust-score/score-package-by-name.js';
import { isValidNpmPackageName as isValidFromClient } from '../../src/clients/npm-registry-client.js';

describe('isValidNpmPackageName', () => {
  it('accepts scoped packages', () => {
    expect(isValidNpmPackageName('@playwright/mcp')).toBe(true);
    expect(isValidFromClient('@modelcontextprotocol/server-filesystem')).toBe(true);
  });

  it('accepts unscoped packages', () => {
    expect(isValidNpmPackageName('lodash')).toBe(true);
  });

  it('rejects invalid names', () => {
    expect(isValidNpmPackageName('')).toBe(false);
    expect(isValidNpmPackageName('@scope')).toBe(false);
    expect(isValidNpmPackageName('not a package')).toBe(false);
  });
});

describe('buildPackageMcpConfig', () => {
  it('builds npx stdio config for scoped package', () => {
    const cfg = buildPackageMcpConfig('@playwright/mcp', '0.0.76');
    expect(cfg.command).toBe('npx');
    expect(cfg.args).toEqual(['-y', '@playwright/mcp@0.0.76']);
    expect(cfg.name).toBe('mcp');
    expect(cfg.packageName).toBe('@playwright/mcp');
  });
});

describe('fetchNpmPackage', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns 404 for unknown package', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(null, { status: 404 }),
    );
    const { fetchNpmPackage, NpmPackageNotFoundError } = await import(
      '../../src/clients/npm-registry-client.js'
    );
    await expect(fetchNpmPackage('not-a-real-pkg-xyz-abc')).rejects.toThrow(NpmPackageNotFoundError);
  });

  it('resolves latest version from registry doc', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          name: '@playwright/mcp',
          'dist-tags': { latest: '0.0.76' },
          versions: {
            '0.0.76': {
              name: '@playwright/mcp',
              version: '0.0.76',
              description: 'Playwright MCP server',
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const { fetchNpmPackage } = await import('../../src/clients/npm-registry-client.js');
    const meta = await fetchNpmPackage('@playwright/mcp');
    expect(meta.version).toBe('0.0.76');
    expect(meta.description).toContain('Playwright');
  });
});
