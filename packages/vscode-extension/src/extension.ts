/**
 * Mastyf Shield for VS Code, Cursor and Windsurf. Shows whether this editor's MCP servers are routed
 * through the Shield app, and what Shield blocked. The extension checks nothing itself and never
 * changes Shield or any settings file.
 */
import { execFile, spawn } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync, statSync } from 'node:fs';
import { win32 as path } from 'node:path';
import * as vscode from 'vscode';
import { blockDetailText, toBlockRows, type BlockRow } from './blocks';
import { makeFileAccess, safePollSeconds, safePort } from './files';
import { findShieldExe, REG_QUERY_ARGS } from './install';
import { BlockNotifier } from './notify';
import { BlocksPanel, type PanelNode, type PanelState } from './panel';
import { editorFromAppName, settingsFilesFor, SettingsReader, type AgentId, type Env } from './settings';
import { ShieldClient } from './shield';
import { computeStatus } from './status';

const DOWNLOAD_URL = 'https://www.mastyf.ai/download';
const PANEL_ROWS = 25;
const POLL_ROWS = 50;

/** Settings files can come from any cloned repository: local drives only, links checked, small regular files. */
const { readSmallFile, mtimeOf } = makeFileAccess({
  lstat: (p) => lstatSync(p),
  readlink: (p) => readlinkSync(p),
  stat: (p) => statSync(p),
  readFile: (p) => readFileSync(p, "utf8"),
});

const exists = (p: string) => mtimeOf(p) !== null;

function regQuery(): Promise<string> {
  return new Promise((resolve) => {
    execFile('reg', REG_QUERY_ARGS, { windowsHide: true, timeout: 5000 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

export function activate(context: vscode.ExtensionContext): void {
  const windows = process.platform === 'win32';
  const windowLoadedAtMs = Date.now();
  const env = process.env as Env;
  const output = vscode.window.createOutputChannel('Mastyf Shield');
  const editor = editorFromAppName(vscode.env.appName);
  const keyFile = path.join(env.APPDATA || '', 'Mastyf Shield', 'mastyf-home', 'dashboard_api_key');

  const config = () => vscode.workspace.getConfiguration('mastyfShield');
  const readKey = (): string | null => {
    try {
      const key = readSmallFile(keyFile).trim();
      return key.length >= 16 ? key : null;
    } catch {
      return null;
    }
  };
  const client = () => new ShieldClient({ port: safePort(config().get('port')), readKey });

  const reader = new SettingsReader(readSmallFile, mtimeOf);
  const notifier = new BlockNotifier();
  const panel = new BlocksPanel();
  const tree = vscode.window.createTreeView('mastyfShield.blocks', { treeDataProvider: panel });
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  context.subscriptions.push(output, tree, item);

  let exe: string | null = null;
  let shieldAnswering = false;
  let onlyThisEditor = false;
  let latestRows: BlockRow[] = [];
  let lastState = '';
  let lastNote = '';
  /** Server names in this editor's (and companions') settings files; Shield 0.5.2 records no agent per call. */
  let myServers = new Set<string>();
  const isMine = (row: BlockRow) => myServers.has(row.server);

  /** This editor, plus Claude Code and Cline when their extensions are installed. */
  const agents = (): AgentId[] => {
    const list: AgentId[] = editor ? [editor] : [];
    if (vscode.extensions.getExtension('anthropic.claude-code')) list.push('claude-code');
    if (vscode.extensions.getExtension('saoudrizwan.claude-dev')) list.push('cline');
    return list;
  };
  const folders = () => (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath);
  const installed = () => Boolean(exe) || exists(keyFile);

  function refreshStatus(): void {
    let servers: ReturnType<SettingsReader['read']>['servers'] = [];
    myServers = new Set<string>();
    let newest = 0;
    if (windows && installed()) {
      for (const agent of agents()) {
        const out = reader.read(agent, settingsFilesFor(agent, env, folders(), exists), folders());
        servers = servers.concat(out.servers);
        for (const s of out.servers) myServers.add(s.name);
        if (agent === editor) newest = Math.max(newest, out.newestMtimeMs);
      }
    }
    const view = computeStatus({
      platform: process.platform,
      installed: installed(),
      editor,
      servers,
      shieldAnswering,
      newestSettingsMtimeMs: newest,
      windowLoadedAtMs,
      reloadApplies: true,
    });
    item.text = `$(shield) ${view.text}`;
    item.tooltip = view.tooltip;
    item.command = view.command;
    item.backgroundColor = view.warning ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    item.show();
    if (view.kind !== lastState) output.appendLine(`${new Date().toISOString()} status: ${view.kind}`);
    lastState = view.kind;
  }

  function showRows(): void {
    const rows = onlyThisEditor ? latestRows.filter(isMine) : latestRows;
    const state: PanelState = !windows ? 'windows-only' : !installed() ? 'not-installed' : shieldAnswering ? 'ok' : 'shield-closed';
    panel.update(rows.slice(0, PANEL_ROWS), state);
    tree.description = onlyThisEditor ? 'this editor' : 'all agents';
  }

  async function poll(): Promise<void> {
    if (!windows) return;
    const receipts = await client().receipts(POLL_ROWS);
    if ((receipts !== null) !== shieldAnswering) output.appendLine(`${new Date().toISOString()} Shield ${receipts ? 'answering' : 'not answering'}`);
    shieldAnswering = receipts !== null;
    latestRows = receipts ? toBlockRows(receipts, POLL_ROWS) : [];
    showRows();
    refreshStatus();
    if (!receipts) return;
    const note = notifier.observe(latestRows, isMine, Date.now());
    if (note) lastNote = note.text;
    if (note && config().get<boolean>('notifyOnBlock', true)) {
      const pick = await vscode.window.showInformationMessage(note.text, 'Show details');
      if (pick === 'Show details') revealRow(note.rowId);
    }
  }

  function revealRow(rowId?: string): void {
    const node = rowId ? panel.nodeFor(rowId) : undefined;
    if (node) void tree.reveal(node, { expand: true, focus: true, select: true });
    else void vscode.commands.executeCommand('mastyfShield.blocks.focus');
  }

  // Poll only while this window has focus.
  let timer: ReturnType<typeof setInterval> | undefined;
  const stopPolling = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
  const startPolling = () => {
    stopPolling();
    if (!windows) return;
    void poll();
    const seconds = safePollSeconds(config().get('pollSeconds'));
    timer = setInterval(() => void poll(), seconds * 1000);
  };
  context.subscriptions.push({ dispose: stopPolling });
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((s) => {
      if (s.focused) {
        refreshStatus();
        startPolling();
      } else stopPolling();
    }),
  );

  // Recompute when any watched settings file changes.
  let watchers: vscode.Disposable[] = [];
  const watchSettings = () => {
    watchers.forEach((w) => w.dispose());
    watchers = [];
    if (!windows) return;
    for (const agent of agents()) {
      for (const file of settingsFilesFor(agent, env, folders(), exists)) {
        const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(file)), path.basename(file)));
        w.onDidChange(refreshStatus);
        w.onDidCreate(refreshStatus);
        w.onDidDelete(refreshStatus);
        watchers.push(w);
      }
    }
  };
  context.subscriptions.push({ dispose: () => watchers.forEach((w) => w.dispose()) });
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      watchSettings();
      refreshStatus();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('mastyfShield')) startPolling();
    }),
  );

  const register = (id: string, fn: (...args: any[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  register('mastyfShield.showPanel', () => vscode.commands.executeCommand('mastyfShield.blocks.focus'));
  register('mastyfShield.refresh', () => poll());
  register('mastyfShield.openDownload', () => vscode.env.openExternal(vscode.Uri.parse(DOWNLOAD_URL)));
  register('mastyfShield.copyDetails', async (node?: PanelNode) => {
    if (!node || node.kind === 'empty') return;
    await vscode.env.clipboard.writeText(blockDetailText(node.row));
    vscode.window.setStatusBarMessage('Copied the block details', 3000);
  });
  register('mastyfShield.toggleThisEditorOnly', () => {
    onlyThisEditor = !onlyThisEditor;
    showRows();
  });
  register('mastyfShield.openShield', async () => {
    if (!windows) return vscode.env.openExternal(vscode.Uri.parse(DOWNLOAD_URL));
    if (await client().answering()) {
      return vscode.window.showInformationMessage('Shield is already running; switch to its window.');
    }
    exe = findShieldExe(await regQuery(), env, exists);
    if (!exe) return vscode.env.openExternal(vscode.Uri.parse(DOWNLOAD_URL));
    // Starting a second copy while one runs would make both fight over Shield's ports, hence the check above.
    const child = spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', () => output.appendLine(`${new Date().toISOString()} could not start Shield`));
    child.unref();
  });
  register('mastyfShield.turnOn', async () => {
    const pick = await vscode.window.showInformationMessage(
      'To protect this editor: open Mastyf Shield, go to Account → Protection, turn on "Route MCP servers through Shield", then reload this window.',
      'Open Shield',
      'Reload window',
    );
    if (pick === 'Open Shield') await vscode.commands.executeCommand('mastyfShield.openShield');
    if (pick === 'Reload window') await vscode.commands.executeCommand('workbench.action.reloadWindow');
  });

  // For the automated smoke run only; not registered in normal use.
  if (process.env.MASTYF_SHIELD_EXT_SMOKE === '1') {
    register('mastyfShield._smokeState', async () => {
      await poll();
      return {
        statusText: item.text,
        tooltip: item.tooltip,
        shieldAnswering,
        installed: installed(),
        exe,
        agents: agents(),
        rows: panel.getChildren().map((n) => (n.kind === 'row' ? { ...n.row } : { empty: n.label })),
        firstRowDetails: (() => {
          const first = panel.getChildren()[0];
          return first && first.kind === 'row' ? panel.getChildren(first).map((d) => (d.kind === 'detail' ? d.label : '')) : [];
        })(),
        lastNote,
      };
    });
  }

  // Start: find Shield, show the status, watch the settings, poll while focused.
  refreshStatus();
  showRows();
  if (windows) {
    void regQuery().then((out) => {
      exe = findShieldExe(out, env, exists);
      watchSettings();
      refreshStatus();
      showRows();
      if (vscode.window.state.focused) startPolling();
    });
  }
}

export function deactivate(): void {}
