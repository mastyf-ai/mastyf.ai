import { describe, it, expect } from 'vitest';
import { extractPackagesFromServer, isLikelyPackageArg } from '../../src/utils/package-extractor.js';

describe('extractPackagesFromServer', () => {
  it('extracts scoped npm package from npx args', () => {
    const pkgs = extractPackagesFromServer({
      command: 'npx',
      args: ['-y', '@modelcontextprotool/server-filesystem', '/tmp'],
    });
    expect(pkgs).toContain('@modelcontextprotool/server-filesystem');
    expect(pkgs).not.toContain('/tmp');
  });

  it('extracts official filesystem package', () => {
    const pkgs = extractPackagesFromServer({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/data'],
    });
    expect(pkgs).toContain('@modelcontextprotocol/server-filesystem');
    expect(pkgs).not.toContain('/data');
  });

  it('ignores numeric and path npx args', () => {
    expect(isLikelyPackageArg('3000')).toBe(false);
    expect(isLikelyPackageArg('/tmp/workspace')).toBe(false);
    const pkgs = extractPackagesFromServer({
      command: 'npx',
      args: ['-y', '42', '/var/run', 'my-mcp-server'],
    });
    expect(pkgs).toContain('my-mcp-server');
    expect(pkgs).not.toContain('42');
    expect(pkgs).not.toContain('/var/run');
  });

  it('gates server.packageName the same as args (rejects "3")', () => {
    const pkgs = extractPackagesFromServer({
      packageName: '3',
      command: 'npx',
      args: ['-y', '@scope/pkg'],
    });
    expect(pkgs).not.toContain('3');
    expect(pkgs).toContain('@scope/pkg');
  });
});
