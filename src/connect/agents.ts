/** The AI agents `connect` can find on this machine, and where each keeps its MCP config. */
import fs from 'node:fs';
import path from 'node:path';

export interface KnownAgent {
  id: string;
  name: string;
  configPaths(home: string): string[];
}

/** The same file under each platform's per-user app folder. */
function appData(home: string, rel: string): string[] {
  return [
    path.join(home, 'Library/Application Support', rel),
    path.join(home, '.config', rel),
    path.join(home, 'AppData/Roaming', rel),
  ];
}

const CLINE = 'Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json';

export const KNOWN_AGENTS: KnownAgent[] = [
  { id: 'claude-desktop', name: 'Claude Desktop', configPaths: (h) => appData(h, 'Claude/claude_desktop_config.json') },
  { id: 'claude-code', name: 'Claude Code', configPaths: (h) => [path.join(h, '.claude.json')] },
  { id: 'cursor', name: 'Cursor', configPaths: (h) => [path.join(h, '.cursor/mcp.json')] },
  { id: 'windsurf', name: 'Windsurf', configPaths: (h) => [path.join(h, '.codeium/windsurf/mcp_config.json')] },
  { id: 'cline', name: 'Cline', configPaths: (h) => appData(h, CLINE) },
  { id: 'vscode', name: 'VS Code', configPaths: (h) => appData(h, 'Code/User/mcp.json') },
];

export function findAgents(home: string): { agent: KnownAgent; configPath: string }[] {
  const found: { agent: KnownAgent; configPath: string }[] = [];
  for (const agent of KNOWN_AGENTS) {
    const configPath = agent.configPaths(home).find((p) => fs.existsSync(p));
    if (configPath) found.push({ agent, configPath });
  }
  return found;
}
