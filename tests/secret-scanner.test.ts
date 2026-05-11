import { describe, it, expect } from 'vitest';
import { SecretScanner } from '../src/scanners/secret-scanner.js';

describe('SecretScanner', () => {
  const scanner = new SecretScanner();

  it('detects long base64-like pattern (60+ char api key)', () => {
    const findings = scanner.scan({
      name: 'test',
      transport: 'stdio',
      env: { OPENAI_API_KEY: 'sk-' + 'abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqrstuvwxyz' },
    });
    expect(findings.some((f) => f.type === 'base64_large')).toBe(true);
  });

  it('detects api_key_header pattern when value contains api_key=<secret>', () => {
    const findings = scanner.scan({
      name: 'test',
      transport: 'stdio',
      env: { CREDENTIALS: 'api_key=abcdefghijklmnopqrstuvwxyz' },
    });
    expect(findings.some((f) => f.type === 'api_key_header')).toBe(true);
  });

  it('detects bearer_token pattern when value contains token=<secret>', () => {
    const findings = scanner.scan({
      name: 'test',
      transport: 'stdio',
      env: { HEADER: 'token=abcdefghijklmnopqrstuvwxyz' },
    });
    expect(findings.some((f) => f.type === 'bearer_token')).toBe(true);
  });

  it('detects bearer_token pattern for auth=bearer...', () => {
    const findings = scanner.scan({
      name: 'test',
      transport: 'stdio',
      env: { AUTH: 'bearer=abcdefghijklmnopqrstuvwxyz123456' },
    });
    expect(findings.some((f) => f.type === 'bearer_token')).toBe(true);
  });

  it('detects GitHub token pattern', () => {
    const findings = scanner.scan({
      name: 'test',
      transport: 'stdio',
      env: { GH_TOKEN: 'ghp_abcdefghijklmnopqrstuvwxyz1234567890' },
    });
    expect(findings.some((f) => f.type === 'github_token')).toBe(true);
  });

  it('detects password_assign when value contains password=<length8+>', () => {
    const findings = scanner.scan({
      name: 'test',
      transport: 'stdio',
      env: { CONFIG: 'password=supersecret123' },
    });
    expect(findings.some((f) => f.type === 'password_assign')).toBe(true);
  });

  it('ignores short values that do not match patterns', () => {
    const findings = scanner.scan({
      name: 'test',
      transport: 'stdio',
      env: { API_KEY: 'short' },
    });
    expect(findings).toHaveLength(0);
  });

  it('detects secrets in command args', () => {
    const findings = scanner.scan({
      name: 'test',
      transport: 'stdio',
      command: 'npx',
      args: ['--api-key', 'sk-' + 'abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqrstuvwxyz123456'],
      env: {},
    });
    expect(findings.some((f) => f.location === 'command_args')).toBe(true);
    expect(findings.some((f) => f.severity === 'HIGH')).toBe(true);
  });

  it('returns empty for clean config', () => {
    const findings = scanner.scan({
      name: 'clean',
      transport: 'stdio',
      command: 'npx',
      env: { HOME: '/home/user' },
    });
    expect(findings).toHaveLength(0);
  });

  it('detects rsa_private keys via BEGIN marker', () => {
    const findings = scanner.scan({
      name: 'test',
      transport: 'stdio',
      env: { KEY: '-----BEGIN RSA PRIVATE KEY-----\nabc123\n-----END RSA PRIVATE KEY-----' },
    });
    expect(findings.some((f) => f.type === 'rsa_private')).toBe(true);
    expect(findings[0].severity).toBe('HIGH');
  });
});