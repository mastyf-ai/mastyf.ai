import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { runWrap } from '../../src/wrap/client-wrap.js';

describe('client-wrap', () => {
  let tmp: string;
  let projectRoot: string;
  let clientConfig: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mastyf-ai-wrap-'));
    projectRoot = path.join(tmp, 'mastyf-ai');
    fs.mkdirSync(path.join(projectRoot, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'dist/cli.js'), '// stub\n', 'utf-8');
    fs.writeFileSync(
      path.join(projectRoot, 'scripts/mastyf-ai-proxy.sh'),
      '#!/bin/sh\nexec node "$@"\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'scripts/mastyf-ai-proxy.ps1'),
      '& node "$cliPath" proxy @args\n',
      'utf-8',
    );
    fs.chmodSync(path.join(projectRoot, 'scripts/mastyf-ai-proxy.sh'), 0o755);
    fs.writeFileSync(
      path.join(projectRoot, 'policy-audit.yaml'),
      "version: '1.0'\npolicy:\n  mode: audit\n  rules: []\n",
      'utf-8',
    );

    clientConfig = path.join(tmp, 'cline_mcp_settings.json');
    fs.writeFileSync(
      clientConfig,
      JSON.stringify({
        mcpServers: {
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
            transport: 'stdio',
          },
          'mastyf-ai': {
            command: 'node',
            args: [path.join(projectRoot, 'dist/index.js')],
            transport: 'stdio',
          },
        },
      }, null, 2),
      'utf-8',
    );
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('writes per-server mastyf-ai-configs and example wrapped JSON', () => {
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      const result = runWrap({
        client: 'auto',
        configPath: clientConfig,
        projectRoot,
        policyPath: 'policy-audit.yaml',
        apply: false,
      });

      expect(result.wrapped).toEqual(['github']);
      expect(result.skipped.some((s) => s.includes('mastyf-ai'))).toBe(true);
      expect(fs.existsSync(path.join(projectRoot, 'mastyf-ai-configs/github.json'))).toBe(true);

      const example = JSON.parse(
        fs.readFileSync(
          path.join(projectRoot, 'examples/cline_mcp_settings.wrapped.json'),
          'utf-8',
        ),
      );
      expect(example.mcpServers.github.command).toContain('mastyf-ai-proxy.sh');
    } finally {
      Object.defineProperty(process, 'platform', { value: original });
    }
  });

  it('uses mastyf-ai-proxy.ps1 via powershell on win32', () => {
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      const result = runWrap({
        client: 'auto',
        configPath: clientConfig,
        projectRoot,
        policyPath: 'policy-audit.yaml',
        apply: true,
      });
      const live = JSON.parse(fs.readFileSync(clientConfig, 'utf-8'));
      expect(live.mcpServers.github.command).toMatch(/powershell/i);
      expect(live.mcpServers.github.args).toContain('-File');
      expect(result.wrapperScript).toContain('mastyf-ai-proxy.ps1');
    } finally {
      Object.defineProperty(process, 'platform', { value: original });
    }
  });

  it('applies patch with backup when --apply', () => {
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      const result = runWrap({
        client: 'auto',
        configPath: clientConfig,
        projectRoot,
        policyPath: 'policy-audit.yaml',
        apply: true,
      });

      expect(result.backupPath).toBeDefined();
      const live = JSON.parse(fs.readFileSync(clientConfig, 'utf-8'));
      expect(live.mcpServers.github.args[0]).toBe('--config');
    } finally {
      Object.defineProperty(process, 'platform', { value: original });
    }
  });

  it('finds a relative policy in the folder the command runs from', () => {
    const workdir = path.join(tmp, 'work');
    fs.mkdirSync(workdir);
    const mine = path.join(workdir, 'my-policy.yaml');
    fs.writeFileSync(mine, "version: '1.0'\npolicy:\n  mode: block\n  rules: []\n", 'utf-8');
    const originalCwd = process.cwd();
    process.chdir(workdir);
    try {
      const result = runWrap({
        client: 'auto',
        configPath: clientConfig,
        projectRoot,
        policyPath: './my-policy.yaml',
        apply: true,
      });
      expect(result.wrapped).toEqual(['github']);
      const live = JSON.parse(fs.readFileSync(clientConfig, 'utf-8'));
      const args: string[] = live.mcpServers.github.args;
      expect(fs.realpathSync(args[args.indexOf('--policy') + 1])).toBe(fs.realpathSync(mine));
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('prefers a policy in the current folder over one of the same name in the install', () => {
    const workdir = path.join(tmp, 'work');
    fs.mkdirSync(workdir);
    const mine = path.join(workdir, 'policy-audit.yaml');
    fs.writeFileSync(mine, "version: '1.0'\npolicy:\n  mode: block\n  rules: []\n", 'utf-8');
    const originalCwd = process.cwd();
    process.chdir(workdir);
    try {
      runWrap({
        client: 'auto',
        configPath: clientConfig,
        projectRoot,
        policyPath: 'policy-audit.yaml',
        apply: true,
      });
      const live = JSON.parse(fs.readFileSync(clientConfig, 'utf-8'));
      const args: string[] = live.mcpServers.github.args;
      expect(fs.realpathSync(args[args.indexOf('--policy') + 1])).toBe(fs.realpathSync(mine));
    } finally {
      process.chdir(originalCwd);
    }
  });
});
