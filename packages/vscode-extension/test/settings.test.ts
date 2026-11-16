import { describe, expect, it } from 'vitest';
import { editorFromAppName, settingsFilesFor, SettingsReader, type Env } from '../src/settings';

const env: Env = {
  APPDATA: 'C:\\Users\\u\\AppData\\Roaming',
  LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
  USERPROFILE: 'C:\\Users\\u',
};

const routed = { command: 'node', args: ['launcher.cjs', 'proxy', '--policy', 'p.yaml'], _mastyf: { managed: true, version: 2 } };
const plain = { command: 'npx', args: ['server'] };

/** An in-memory file system: path → [content, mtime]. A content of null means "exists but can't be read". */
function files(map: Record<string, [string | null, number]>) {
  const readFile = (p: string) => {
    const f = map[p];
    if (!f || f[0] === null) throw new Error(`cannot read ${p}`);
    return f[0];
  };
  const statMtimeMs = (p: string) => (map[p] ? map[p][1] : null);
  return { map, readFile, statMtimeMs };
}

describe('editorFromAppName', () => {
  it('knows the four editors', () => {
    expect(editorFromAppName('Visual Studio Code')).toBe('vscode');
    expect(editorFromAppName('Visual Studio Code - Insiders')).toBe('vscode-insiders');
    expect(editorFromAppName('Cursor')).toBe('cursor');
    expect(editorFromAppName('Windsurf')).toBe('windsurf');
    expect(editorFromAppName('Code - OSS')).toBeNull();
  });
});

describe('settingsFilesFor', () => {
  const userCursor = 'C:\\Users\\u\\.cursor\\mcp.json';
  const globalCursor = 'C:\\Users\\u\\AppData\\Roaming\\Cursor\\User\\globalStorage\\cursor.mcp\\mcp.json';

  it('Cursor: only the first user file that exists, plus each folder', () => {
    const both = (p: string) => p === userCursor || p === globalCursor;
    expect(settingsFilesFor('cursor', env, ['C:\\work\\app'], both)).toEqual([userCursor, 'C:\\work\\app\\.cursor\\mcp.json']);
    const onlyGlobal = (p: string) => p === globalCursor;
    expect(settingsFilesFor('cursor', env, [], onlyGlobal)).toEqual([globalCursor]);
  });

  it('VS Code: the user file and each folder', () => {
    expect(settingsFilesFor('vscode', env, ['C:\\a', 'D:\\b'], () => false)).toEqual([
      'C:\\Users\\u\\AppData\\Roaming\\Code\\User\\mcp.json',
      'C:\\a\\.vscode\\mcp.json',
      'D:\\b\\.vscode\\mcp.json',
    ]);
  });

  it('VS Code Insiders: none (Shield 0.5.2 does not route it)', () => {
    expect(settingsFilesFor('vscode-insiders', env, ['C:\\a'], () => true)).toEqual([]);
  });

  it('Windsurf, Claude Code and Cline', () => {
    expect(settingsFilesFor('windsurf', env, [], () => false)).toEqual(['C:\\Users\\u\\.codeium\\windsurf\\mcp_config.json']);
    expect(settingsFilesFor('claude-code', env, ['C:\\a'], () => false)).toEqual(['C:\\Users\\u\\.claude.json', 'C:\\a\\.mcp.json']);
    expect(settingsFilesFor('cline', env, [], () => false)).toEqual([
      'C:\\Users\\u\\AppData\\Roaming\\Code\\User\\globalStorage\\saoudrizwan.claude-dev\\settings\\cline_mcp_settings.json',
    ]);
  });
});

describe('SettingsReader', () => {
  const vsFile = 'C:\\Users\\u\\AppData\\Roaming\\Code\\User\\mcp.json';

  it("reads VS Code's servers with their routing state", () => {
    const fs = files({ [vsFile]: [JSON.stringify({ servers: { a: routed, b: plain } }), 100] });
    const out = new SettingsReader(fs.readFile, fs.statMtimeMs).read('vscode', [vsFile], []);
    expect(out.servers).toEqual([
      { name: 'a', file: vsFile, agent: 'vscode', state: 'routed' },
      { name: 'b', file: vsFile, agent: 'vscode', state: 'fixable' },
    ]);
  });

  it('a file with comments: Shield cannot read it, so its servers are unrouted', () => {
    const text = '{\n  // my servers\n  "servers": { "a": ' + JSON.stringify(routed) + ' }\n}';
    const fs = files({ [vsFile]: [text, 100] });
    const out = new SettingsReader(fs.readFile, fs.statMtimeMs).read('vscode', [vsFile], []);
    expect(out.servers).toEqual([{ name: 'a', file: vsFile, agent: 'vscode', state: 'unreadable-by-shield' }]);
  });

  it('an empty file has no servers', () => {
    const fs = files({ [vsFile]: ['', 100] });
    expect(new SettingsReader(fs.readFile, fs.statMtimeMs).read('vscode', [vsFile], []).servers).toEqual([]);
  });

  it('a missing file has no servers', () => {
    const fs = files({});
    const out = new SettingsReader(fs.readFile, fs.statMtimeMs).read('vscode', [vsFile], []);
    expect(out.servers).toEqual([]);
    expect(out.newestMtimeMs).toBe(0);
  });

  it('a file being saved (half-written, or locked) keeps the last good read', () => {
    const fs = files({ [vsFile]: [JSON.stringify({ servers: { a: routed } }), 100] });
    const reader = new SettingsReader(fs.readFile, fs.statMtimeMs);
    const first = reader.read('vscode', [vsFile], []).servers;

    fs.map[vsFile] = ['{ "servers": { "a": { "comm', 101];
    expect(reader.read('vscode', [vsFile], []).servers).toEqual(first);

    fs.map[vsFile] = [null, 102];
    expect(reader.read('vscode', [vsFile], []).servers).toEqual(first);
  });

  it("Claude Code: top-level servers and the open folder's project servers", () => {
    const claudeFile = 'C:\\Users\\u\\.claude.json';
    const json = {
      mcpServers: { top: routed },
      projects: { 'C:/Work/app': { mcpServers: { proj: plain } }, 'C:/Other': { mcpServers: { other: plain } } },
    };
    const fs = files({ [claudeFile]: [JSON.stringify(json), 100] });
    const out = new SettingsReader(fs.readFile, fs.statMtimeMs).read('claude-code', [claudeFile], ['c:\\work\\app\\']);
    expect(out.servers.map((s) => [s.name, s.state])).toEqual([
      ['top', 'routed'],
      ['proj', 'fixable'],
    ]);
  });

  it('newestMtimeMs is the latest change among the files read', () => {
    const proj = 'C:\\a\\.vscode\\mcp.json';
    const fs = files({ [vsFile]: ['{}', 100], [proj]: ['{}', 250] });
    expect(new SettingsReader(fs.readFile, fs.statMtimeMs).read('vscode', [vsFile, proj], []).newestMtimeMs).toBe(250);
  });
});
