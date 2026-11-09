import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import {
  quotePathForPowerShell,
  resolveMastyfAiProxyWrapper,
  buildWrappedMcpServerEntry,
} from '../../src/utils/windows-paths.js';

describe('windows-paths', () => {
  const projectRoot = path.join('C:', 'Users', 'John Doe', 'mastyf-ai');
  const configPath = path.join(projectRoot, 'mastyf-ai-configs', 'github.json');
  const policyPath = path.join(projectRoot, 'policy-audit.yaml');

  describe('quotePathForPowerShell', () => {
    it('wraps paths with spaces in double quotes', () => {
      expect(quotePathForPowerShell('C:\\Users\\John Doe\\.cursor')).toBe(
        '"C:\\Users\\John Doe\\.cursor"',
      );
    });

    it('escapes embedded double quotes and backticks', () => {
      expect(quotePathForPowerShell('C:\\temp\\`weird`"name')).toBe(
        '"C:\\temp\\``weird```"name"',
      );
    });
  });

  describe('resolveMastyfAiProxyWrapper', () => {
    const originalPlatform = process.platform;

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('returns scripts/mastyf-ai-proxy.ps1 on win32', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      expect(resolveMastyfAiProxyWrapper(projectRoot)).toBe(
        path.join(projectRoot, 'scripts', 'mastyf-ai-proxy.ps1'),
      );
    });

    it('returns scripts/mastyf-ai-proxy.sh on non-win32', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      expect(resolveMastyfAiProxyWrapper(projectRoot)).toBe(
        path.join(projectRoot, 'scripts', 'mastyf-ai-proxy.sh'),
      );
    });
  });

  describe('buildWrappedMcpServerEntry', () => {
    const originalPlatform = process.platform;

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('uses powershell -File with spaced paths on win32', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const entry = buildWrappedMcpServerEntry(projectRoot, configPath, policyPath);
      expect(entry.command).toMatch(/powershell/i);
      expect(entry.args[0]).toBe('-NoProfile');
      expect(entry.args).toContain('-File');
      expect(entry.args).toContain(path.join(projectRoot, 'scripts', 'mastyf-ai-proxy.ps1'));
      expect(entry.args).toContain(configPath);
      expect(entry.args).toContain(policyPath);
    });

    it('uses shell wrapper directly on unix', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      const entry = buildWrappedMcpServerEntry(projectRoot, configPath, policyPath);
      expect(entry.command).toBe(path.join(projectRoot, 'scripts', 'mastyf-ai-proxy.sh'));
      expect(entry.args).toEqual(['--config', configPath, '--policy', policyPath]);
    });
  });

  describe('mastyf-ai-proxy.ps1 on disk', () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

    it('exists under scripts/ with try/catch and arg forwarding', () => {
      const scriptsScript = path.join(repoRoot, 'scripts', 'mastyf-ai-proxy.ps1');
      expect(fs.existsSync(scriptsScript)).toBe(true);

      const content = fs.readFileSync(scriptsScript, 'utf-8');
      expect(content).toMatch(/ValueFromRemainingArguments/);
      expect(content).toMatch(/& \$nodeExe @argList/);
      expect(content).toMatch(/try \{/);
      expect(content).toMatch(/MASTYF_AI_DB_PATH/);
      expect(content).toMatch(/DASHBOARD_ENABLED/);
    });

    it('starts with its param block, as PowerShell requires', () => {
      const content = fs.readFileSync(path.join(repoRoot, 'scripts', 'mastyf-ai-proxy.ps1'), 'utf-8');
      const firstCode = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith('#'));
      expect(firstCode).toBe('param(');
    });

    it('ships the wrapper scripts and a default policy in the npm package', () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8')) as { files: string[] };
      for (const file of ['scripts/mastyf-ai-proxy.sh', 'scripts/mastyf-ai-proxy.ps1', 'default-policy.yaml']) {
        expect(pkg.files).toContain(file);
        expect(fs.existsSync(path.join(repoRoot, file))).toBe(true);
      }
    });
  });
});
