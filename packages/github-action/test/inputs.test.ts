import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InputError, readInputs } from '../src/inputs.js';
import { exportVariable, warning } from '../src/runner.js';

const workspace = mkdtempSync(join(tmpdir(), 'mastyf-action-ws-'));
mkdirSync(join(workspace, '.mastyf'), { recursive: true });
writeFileSync(join(workspace, '.mastyf', 'policy.yaml'), 'policy: {}\n');

const inputs = (values: Record<string, string>) => Object.fromEntries(Object.entries(values).map(([k, v]) => [`INPUT_${k.toUpperCase()}`, v]));

describe('readInputs', () => {
  it('has the documented defaults', () => {
    expect(readInputs({}, workspace)).toEqual({
      failOnBlock: false,
      mode: 'block',
      policy: undefined,
      port: 0,
      maxBodyMb: 32,
      showReasons: false,
      onError: 'fail',
      claudeCode: false,
      claudeSettingsBase: undefined,
    });
  });

  it('reads every input', () => {
    const r = readInputs(
      inputs({ 'fail-on-block': 'true', mode: 'observe', policy: '.mastyf/policy.yaml', port: '4100', 'max-body-mb': '8', 'show-reasons': 'true', 'on-error': 'continue' }),
      workspace,
    );
    expect(r).toEqual({ failOnBlock: true, mode: 'observe', policy: join(workspace, '.mastyf', 'policy.yaml'), port: 4100, maxBodyMb: 8, showReasons: true, onError: 'continue', claudeCode: false, claudeSettingsBase: undefined });
  });

  it.each([
    [{ mode: 'warn' }, 'mode'],
    [{ 'fail-on-block': 'yes' }, 'fail-on-block'],
    [{ 'on-error': 'ignore' }, 'on-error'],
    [{ port: '70000' }, 'port'],
    [{ 'max-body-mb': '65' }, 'max-body-mb'],
    [{ 'max-body-mb': '0' }, 'max-body-mb'],
  ])('rejects %j naming the input', (values, name) => {
    expect(() => readInputs(inputs(values as Record<string, string>), workspace)).toThrow(InputError);
    expect(() => readInputs(inputs(values as Record<string, string>), workspace)).toThrow(name);
  });

  it('rejects a policy outside the workspace or missing', () => {
    expect(() => readInputs(inputs({ policy: '../outside.yaml' }), workspace)).toThrow(/outside the workspace/);
    expect(() => readInputs(inputs({ policy: '.mastyf/nope.yaml' }), workspace)).toThrow(/nope\.yaml/);
  });
});

describe('runner protocol', () => {
  it('exportVariable uses a delimiter that is not in the value', () => {
    const file = join(workspace, 'github_env');
    writeFileSync(file, '');
    exportVariable('MASTYF_X', 'a\nb', { GITHUB_ENV: file });
    const text = readFileSync(file, 'utf8');
    const [head] = text.split('\n');
    const delim = head!.split('<<')[1]!;
    expect(head).toBe(`MASTYF_X<<${delim}`);
    expect('a\nb').not.toContain(delim);
    expect(text).toBe(`MASTYF_X<<${delim}\na\nb\n${delim}\n`);
  });

  it('escapes workflow command text', () => {
    const lines: string[] = [];
    warning('a\nb%', (l) => lines.push(l));
    expect(lines).toEqual(['::warning::a%0Ab%25']);
  });
});
