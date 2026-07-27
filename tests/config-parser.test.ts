import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ConfigParser } from '../src/config-parser.js';

describe('ConfigParser', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mastyf-ai-test-'));
  });

  it('parses Cline-style config with mcpServers', () => {
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        'filesystem': {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem'],
          transport: 'stdio',
        },
        'github': {
          url: 'https://api.github.com/mcp',
          transport: 'sse',
          env: { API_KEY: 'test' },
        },
      },
    }));
    const servers = ConfigParser.parse(configPath);
    expect(servers).toHaveLength(2);
    expect(servers[0].name).toBe('filesystem');
    expect(servers[0].transport).toBe('stdio');
    expect(servers[0].command).toBe('npx');
    expect(servers[1].name).toBe('github');
    expect(servers[1].transport).toBe('sse');
    expect(servers[1].url).toBe('https://api.github.com/mcp');
    expect(servers[1].env).toEqual({ API_KEY: 'test' });
  });

  it('parses generic config with "servers" key', () => {
    const configPath = path.join(tmpDir, 'generic.json');
    fs.writeFileSync(configPath, JSON.stringify({
      servers: {
        'test-server': { command: 'echo', args: ['hello'] },
      },
    }));
    const servers = ConfigParser.parse(configPath);
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe('test-server');
    expect(servers[0].command).toBe('echo');
  });

  it('rejects JSON array configs that would become numeric server names', () => {
    const configPath = path.join(tmpDir, 'array.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify([{ command: 'npx', args: ['-y', '@scope/pkg'] }]),
    );
    expect(() => ConfigParser.parse(configPath)).toThrow(/JSON array/);
  });

  it('handles missing optional fields with defaults', () => {
    const configPath = path.join(tmpDir, 'minimal.json');
    fs.writeFileSync(configPath, JSON.stringify({
      servers: { 'bare': {} },
    }));
    const servers = ConfigParser.parse(configPath);
    expect(servers[0].transport).toBe('stdio');
    expect(servers[0].command).toBeUndefined();
    expect(servers[0].args).toBeUndefined();
    expect(servers[0].env).toBeUndefined();
  });

  it('extracts packageName and version when present', () => {
    const configPath = path.join(tmpDir, 'with-meta.json');
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        'my-pkg': {
          command: 'npx',
          packageName: '@scope/mcp-server',
          version: '1.2.3',
        },
      },
    }));
    const servers = ConfigParser.parse(configPath);
    expect(servers[0].packageName).toBe('@scope/mcp-server');
    expect(servers[0].version).toBe('1.2.3');
  });

  it('first config wins when deduplicating by name', () => {
    const config1 = path.join(tmpDir, 'c1.json');
    const config2 = path.join(tmpDir, 'c2.json');
    fs.writeFileSync(config1, JSON.stringify({
      mcpServers: {
        'shared': { command: 'first' },
        'unique-a': { command: 'a' },
      },
    }));
    fs.writeFileSync(config2, JSON.stringify({
      mcpServers: {
        'shared': { command: 'second' },
        'unique-b': { command: 'b' },
      },
    }));
    const [servers1, servers2] = [ConfigParser.parse(config1), ConfigParser.parse(config2)];
    expect(servers1[0].command).toBe('first');
    expect(servers2[0].command).toBe('second');
  });

  it('transports "sse" explicitly set', () => {
    const configPath = path.join(tmpDir, 'sse.json');
    fs.writeFileSync(configPath, JSON.stringify({
      servers: {
        'remote': { url: 'https://example.com', transport: 'sse' },
      },
    }));
    const servers = ConfigParser.parse(configPath);
    expect(servers[0].transport).toBe('sse');
  });
});