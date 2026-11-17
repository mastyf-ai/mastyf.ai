/** The status bar item: one state, decided from the editor's settings files and whether Shield answers. */
import type { AgentId, EditorId, ServerEntry } from './settings';

export type StatusKind =
  | 'windows-only'
  | 'not-installed'
  | 'unsupported-editor'
  | 'no-servers'
  | 'off'
  | 'partly'
  | 'reload'
  | 'protected';

export interface StatusInput {
  platform: NodeJS.Platform;
  installed: boolean;
  editor: EditorId | null;
  /** The editor's servers and any companion agent's (Claude Code, Cline). */
  servers: ServerEntry[];
  shieldAnswering: boolean;
  newestSettingsMtimeMs: number;
  windowLoadedAtMs: number;
  /** False for an editor that restarts its MCP servers by itself when the settings change. */
  reloadApplies: boolean;
}

export interface StatusView {
  kind: StatusKind;
  text: string;
  warning: boolean;
  tooltip: string;
  command: string;
}

const AGENT_NAMES: Record<AgentId, string> = {
  vscode: 'VS Code',
  'vscode-insiders': 'VS Code Insiders',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  'claude-code': 'Claude Code',
  cline: 'Cline',
};

const SCOPE_NOTE = 'Protected means the settings files Shield manages are routed through Shield.';
const CLOSED_NOTE = 'Protection continues while Shield is closed; open Shield to see blocked calls.';

function reasonOf(state: ServerEntry['state']): string {
  if (state === 'url') return 'URL-based';
  if (state === 'unreadable-by-shield') return 'file has comments';
  return 'not routed';
}

/** One line per agent, with the servers that aren't routed and why. */
function agentLines(servers: ServerEntry[]): string[] {
  const byAgent = new Map<AgentId, ServerEntry[]>();
  for (const s of servers) byAgent.set(s.agent, [...(byAgent.get(s.agent) ?? []), s]);
  return [...byAgent].map(([agent, list]) => {
    const routed = list.filter((s) => s.state === 'routed').length;
    const missing = list.filter((s) => s.state !== 'routed').map((s) => `${s.name} (${reasonOf(s.state)})`);
    const head = `${AGENT_NAMES[agent]}: ${routed} of ${list.length} routed`;
    return missing.length ? `${head}. Not covered: ${missing.join(', ')}` : head;
  });
}

const view = (kind: StatusKind, text: string, warning: boolean, tooltip: string[], command: string): StatusView => ({
  kind,
  text,
  warning,
  tooltip: tooltip.filter(Boolean).join('\n'),
  command,
});

export function computeStatus(input: StatusInput): StatusView {
  if (input.platform !== 'win32') {
    return view('windows-only', 'Mastyf: Windows only', false, ['Mastyf Shield runs on Windows for now.'], 'mastyfShield.openDownload');
  }
  if (!input.installed) {
    return view('not-installed', 'Mastyf: Install Shield', false, ['Mastyf Shield is not installed on this PC.'], 'mastyfShield.openDownload');
  }
  if (!input.editor || input.editor === 'vscode-insiders') {
    return view(
      'unsupported-editor',
      'Mastyf: Not supported yet',
      false,
      ["Shield doesn't route this editor's MCP servers yet."],
      'mastyfShield.showPanel',
    );
  }

  const own = input.servers.filter((s) => s.agent === input.editor);
  const lines = agentLines(input.servers);
  if (own.length === 0) {
    return view('no-servers', 'Mastyf: No MCP servers', false, ['This editor has no MCP servers to protect.', ...lines], 'mastyfShield.showPanel');
  }

  const routed = own.filter((s) => s.state === 'routed').length;
  if (routed === 0) {
    return view('off', 'Mastyf: Off', true, [...lines, 'Turn on protection in Shield: Account → Protection.'], 'mastyfShield.turnOn');
  }
  if (input.reloadApplies && input.newestSettingsMtimeMs > input.windowLoadedAtMs) {
    return view(
      'reload',
      'Mastyf: Reload to apply',
      true,
      ['Your MCP settings changed after this window started. Reload so the editor uses the routed servers.', ...lines],
      'workbench.action.reloadWindow',
    );
  }

  const closed = input.shieldAnswering ? '' : ' · Shield closed';
  const notes = [...lines, SCOPE_NOTE, input.shieldAnswering ? '' : CLOSED_NOTE];
  if (routed < own.length) {
    return view('partly', `Mastyf: ${routed} of ${own.length} protected${closed}`, true, notes, 'mastyfShield.showPanel');
  }
  return view('protected', `Mastyf: Protected${closed}`, false, notes, 'mastyfShield.showPanel');
}
