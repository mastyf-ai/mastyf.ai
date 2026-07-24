import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

export type HarnessTarget = 'claude' | 'cursor' | 'codex' | 'gemini' | 'all';

interface HarnessConfig {
  configPath: string;
  name: string;
  displayName: string;
}

const HARNESS_CONFIGS: Record<Exclude<HarnessTarget, 'all'>, HarnessConfig> = {
  claude: {
    configPath: join(homedir(), '.claude', 'settings.json'),
    name: 'claude',
    displayName: 'Claude Code',
  },
  cursor: {
    configPath: join(homedir(), '.cursor', 'mcp.json'),
    name: 'cursor',
    displayName: 'Cursor',
  },
  codex: {
    configPath: join(homedir(), '.codex', 'mcp.json'),
    name: 'codex',
    displayName: 'Codex CLI',
  },
  gemini: {
    configPath: join(homedir(), '.gemini', 'mcp.json'),
    name: 'gemini',
    displayName: 'Gemini CLI',
  },
};

export function getHarnessConfig(target: Exclude<HarnessTarget, 'all'>): HarnessConfig {
  return HARNESS_CONFIGS[target];
}

export function getEnabledHarnesses(): HarnessTarget[] {
  const enabled: HarnessTarget[] = [];
  for (const [target, cfg] of Object.entries(HARNESS_CONFIGS) as [Exclude<HarnessTarget, 'all'>, HarnessConfig][]) {
    if (isHarnessEnabled(target)) enabled.push(target);
  }
  return enabled;
}

export function backupConfig(target: Exclude<HarnessTarget, 'all'>): string | null {
  const cfg = getHarnessConfig(target);
  if (!existsSync(cfg.configPath)) return null;
  const backupPath = cfg.configPath + '.mastyf-backup';
  copyFileSync(cfg.configPath, backupPath);
  return backupPath;
}

export function restoreConfig(target: Exclude<HarnessTarget, 'all'>): boolean {
  const cfg = getHarnessConfig(target);
  const backupPath = cfg.configPath + '.mastyf-backup';
  if (!existsSync(backupPath)) return false;
  copyFileSync(backupPath, cfg.configPath);
  return true;
}

export function isHarnessEnabled(target: Exclude<HarnessTarget, 'all'>): boolean {
  const cfg = getHarnessConfig(target);
  if (!existsSync(cfg.configPath)) return false;

  try {
    const content = readFileSync(cfg.configPath, 'utf-8');
    const config = JSON.parse(content);

    if (target === 'claude') {
      return config?.mcpServers && Object.values(config.mcpServers).some(
        (s: any) => s?.command === 'npx' && s?.args?.some((a: string) => a?.includes('mastyf'))
      );
    }

    const servers = config?.mcpServers || config?.mcp_servers || {};
    return Object.values(servers).some(
      (s: any) => {
        const cmd = s?.command || '';
        const args = (s?.args || []).join(' ');
        return (cmd + args).includes('mastyf');
      }
    );
  } catch {
    return false;
  }
}

export function setupHarness(target: Exclude<HarnessTarget, 'all'>, proxyPort?: number): boolean {
  const cfg = getHarnessConfig(target);
  if (!existsSync(cfg.configPath)) {
    console.log(`No ${cfg.displayName} config found at ${cfg.configPath} — skipping.`);
    return false;
  }

  backupConfig(target);

  try {
    const content = readFileSync(cfg.configPath, 'utf-8');
    const config = JSON.parse(content);

    if (target === 'claude') {
      const servers = config?.mcpServers || {};
      for (const [name, serverConfig] of Object.entries(servers)) {
        const sc = serverConfig as any;
        const originalCmd = sc?.command || '';
        const originalArgs = sc?.args || [];

        if (!(originalCmd + originalArgs.join(' ')).includes('mastyf')) {
          sc._mastyf_original_command = originalCmd;
          sc._mastyf_original_args = originalArgs;
          sc.command = 'npx';
          sc.args = ['@mastyf_ai/harness', 'wrap', ...originalArgs];
        }
      }
      writeFileSync(cfg.configPath, JSON.stringify(config, null, 2), 'utf-8');
    } else {
      const servers = config?.mcpServers || config?.mcp_servers || {};
      for (const [name, serverConfig] of Object.entries(servers)) {
        const sc = serverConfig as any;
        if (!(sc?.command || '').includes('mastyf')) {
          sc._mastyf_original = { ...sc };
          sc.command = 'npx';
          sc.args = ['@mastyf_ai/harness', 'wrap', '--config', JSON.stringify(sc._mastyf_original)];
        }
      }
      config.mcpServers = servers;
      writeFileSync(cfg.configPath, JSON.stringify(config, null, 2), 'utf-8');
    }

    console.log(`\u2705 ${cfg.displayName} is now protected by mastyf.ai`);
    return true;
  } catch (err) {
    console.error(`Failed to setup ${cfg.displayName} harness: ${err instanceof Error ? err.message : err}`);
    restoreConfig(target);
    return false;
  }
}

export function teardownHarness(target: Exclude<HarnessTarget, 'all'>): boolean {
  const cfg = getHarnessConfig(target);
  restoreConfig(target);

  try {
    const content = readFileSync(cfg.configPath, 'utf-8');
    const config = JSON.parse(content);

    // Clean up _mastyf fields
    if (target === 'claude') {
      const servers = config?.mcpServers || {};
      for (const [name, serverConfig] of Object.entries(servers)) {
        const sc = serverConfig as any;
        if (sc?._mastyf_original_command) {
          sc.command = sc._mastyf_original_command;
          sc.args = sc._mastyf_original_args;
          delete sc._mastyf_original_command;
          delete sc._mastyf_original_args;
        }
      }
    }
    writeFileSync(cfg.configPath, JSON.stringify(config, null, 2), 'utf-8');
    console.log(`\u274c ${cfg.displayName} no longer protected by mastyf.ai`);
    return true;
  } catch { return false; }
}

export function setupAllHarnesses(proxyPort?: number): { successes: string[]; failures: string[] } {
  const results = { successes: [] as string[], failures: [] as string[] };
  for (const target of Object.keys(HARNESS_CONFIGS) as Exclude<HarnessTarget, 'all'>[]) {
    if (setupHarness(target, proxyPort)) {
      results.successes.push(target);
    } else {
      results.failures.push(target);
    }
  }
  return results;
}
