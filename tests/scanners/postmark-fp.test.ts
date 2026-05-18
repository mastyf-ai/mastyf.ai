import { describe, it, expect } from 'vitest';
import { scanForSecrets } from '../../src/scanners/secret-scanner.js';

describe('postmark-api-token context', () => {
  it('does not flag a bare UUID without postmark context', () => {
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const findings = scanForSecrets(uuid, 'generic-log-line');
    expect(findings.some((f) => f.type === 'postmark-api-token')).toBe(false);
  });

  it('flags UUID when postmark context is present', () => {
    const token = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const findings = scanForSecrets(
      `postmark server token = ${token}`,
      'config.env',
    );
    expect(findings.some((f) => f.type === 'postmark-api-token')).toBe(true);
  });
});
