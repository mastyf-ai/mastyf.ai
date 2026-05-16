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
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-wrap-'));
    projectRoot = path.join(tmp, 'mcp-guardian');
    fs.mkdirSync(path.join(projectRoot, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'dist/cli.js'), '// stub\n', 'utf-8');
    fs.writeFileSync(
      path.join(projectRoot, 'scripts/guardian-proxy.sh'),
      '#!/bin/sh\nexec node "$@"\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'guardian-proxy.ps1'),
      '& node "$cliPath" proxy @args\n',
      'utf-8',
    );
    fs.chmodSync(path.join(projectRoot, 'scripts/guardian-proxy.sh'), 0o755);
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
          'mcp-guardian': {
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

  it('writes per-server guardian-configs and example wrapped JSON', () => {
    const result = runWrap({
      client: 'auto',
      configPath: clientConfig,
      projectRoot,
      policyPath: 'policy-audit.yaml',
      apply: false,
    });

    expect(result.wrapped).toEqual(['github']);
    expect(result.skipped.some((s) => s.includes('mcp-guardian'))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'guardian-configs/github.json'))).toBe(true);

    const example = JSON.parse(
      fs.readFileSync(
        path.join(projectRoot, 'examples/cline_mcp_settings.wrapped.json'),
        'utf-8',
      ),
    );
    expect(example.mcpServers.github.command).toContain('guardian-proxy.sh');
  });

  it('uses guardian-proxy.ps1 via powershell on win32', () => {
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
      expect(result.wrapperScript).toContain('guardian-proxy.ps1');
    } finally {
      Object.defineProperty(process, 'platform', { value: original });
    }
  });

  it('applies patch with backup when --apply', () => {
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
  });
});
