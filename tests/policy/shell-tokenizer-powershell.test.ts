import { describe, it, expect } from 'vitest';
import { ShellTokenizer } from '../../src/policy/shell-tokenizer.js';

const tokenizer = new ShellTokenizer();

describe('ShellTokenizer PowerShell patterns', () => {
  it('detects Invoke-Expression', () => {
    expect(tokenizer.detectPowerShellRisk('Invoke-Expression $cmd')).not.toBeNull();
  });

  it('detects -EncodedCommand', () => {
    expect(tokenizer.detectPowerShellRisk('powershell -EncodedCommand JABj')).not.toBeNull();
  });

  it('detects [Convert]::FromBase64String', () => {
    expect(
      tokenizer.detectPowerShellRisk('[Convert]::FromBase64String("Y21k")'),
    ).not.toBeNull();
  });

  it('ignores benign text', () => {
    expect(tokenizer.detectPowerShellRisk('list files in /tmp')).toBeNull();
  });
});
