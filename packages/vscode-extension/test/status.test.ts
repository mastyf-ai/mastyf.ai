import { describe, expect, it } from 'vitest';
import { computeStatus, type StatusInput } from '../src/status';
import type { ServerEntry } from '../src/settings';

const s = (name: string, state: ServerEntry['state'], agent: ServerEntry['agent'] = 'vscode'): ServerEntry => ({
  name,
  file: 'C:\\x\\mcp.json',
  agent,
  state,
});

const base: StatusInput = {
  platform: 'win32',
  installed: true,
  editor: 'vscode',
  servers: [s('a', 'routed'), s('b', 'routed')],
  shieldAnswering: true,
  newestSettingsMtimeMs: 100,
  windowLoadedAtMs: 200,
  reloadApplies: true,
};

describe('computeStatus', () => {
  it('Mac and Linux: Windows only, whatever else is passed', () => {
    const v = computeStatus({ ...base, platform: 'darwin', installed: false, servers: [] });
    expect(v).toMatchObject({ kind: 'windows-only', text: 'Mastyf: Windows only', command: 'mastyfShield.openDownload' });
  });

  it('Shield not installed', () => {
    expect(computeStatus({ ...base, installed: false })).toMatchObject({
      kind: 'not-installed',
      text: 'Mastyf: Install Shield',
      command: 'mastyfShield.openDownload',
    });
  });

  it('an editor Shield does not route yet', () => {
    expect(computeStatus({ ...base, editor: 'vscode-insiders' })).toMatchObject({ kind: 'unsupported-editor', text: 'Mastyf: Not supported yet' });
    expect(computeStatus({ ...base, editor: null })).toMatchObject({ kind: 'unsupported-editor' });
  });

  it('no MCP servers', () => {
    expect(computeStatus({ ...base, servers: [] })).toMatchObject({ kind: 'no-servers', text: 'Mastyf: No MCP servers', warning: false });
  });

  it('none routed: Off', () => {
    expect(computeStatus({ ...base, servers: [s('a', 'fixable'), s('b', 'url')] })).toMatchObject({
      kind: 'off',
      text: 'Mastyf: Off',
      warning: true,
      command: 'mastyfShield.turnOn',
    });
  });

  it('some routed: 2 of 5 protected', () => {
    const servers = [s('a', 'routed'), s('b', 'routed'), s('c', 'fixable'), s('d', 'url'), s('e', 'unreadable-by-shield')];
    const v = computeStatus({ ...base, servers });
    expect(v).toMatchObject({ kind: 'partly', text: 'Mastyf: 2 of 5 protected', warning: true, command: 'mastyfShield.showPanel' });
    expect(v.tooltip).toContain('c (not routed)');
    expect(v.tooltip).toContain('d (URL-based)');
    expect(v.tooltip).toContain('e (file has comments)');
  });

  it('all routed: Protected', () => {
    const v = computeStatus(base);
    expect(v).toMatchObject({ kind: 'protected', text: 'Mastyf: Protected', warning: false, command: 'mastyfShield.showPanel' });
    expect(v.tooltip).toContain('Protected means the settings files Shield manages are routed');
  });

  it('settings changed after this window loaded: Reload to apply', () => {
    expect(computeStatus({ ...base, newestSettingsMtimeMs: 300 })).toMatchObject({
      kind: 'reload',
      text: 'Mastyf: Reload to apply',
      warning: true,
      command: 'workbench.action.reloadWindow',
    });
  });

  it('no reload state where the editor restarts its servers itself', () => {
    expect(computeStatus({ ...base, newestSettingsMtimeMs: 300, reloadApplies: false })).toMatchObject({ kind: 'protected' });
  });

  it('no reload state while nothing is routed', () => {
    expect(computeStatus({ ...base, servers: [s('a', 'fixable')], newestSettingsMtimeMs: 300 })).toMatchObject({ kind: 'off' });
  });

  it('Shield closed is added to Partly and Protected only', () => {
    const closed = { ...base, shieldAnswering: false };
    const p = computeStatus(closed);
    expect(p.text).toBe('Mastyf: Protected · Shield closed');
    expect(p.tooltip).toContain('Protection continues while Shield is closed; open Shield to see blocked calls.');
    expect(computeStatus({ ...closed, servers: [s('a', 'routed'), s('b', 'fixable')] }).text).toBe('Mastyf: 1 of 2 protected · Shield closed');
    expect(computeStatus({ ...closed, servers: [s('a', 'fixable')] }).text).toBe('Mastyf: Off');
  });

  it("a companion's unrouted servers stay out of the text but show in the tooltip", () => {
    const v = computeStatus({ ...base, servers: [...base.servers, s('cc', 'fixable', 'claude-code')] });
    expect(v.text).toBe('Mastyf: Protected');
    expect(v.tooltip).toContain('Claude Code');
    expect(v.tooltip).toContain('cc (not routed)');
  });
});
