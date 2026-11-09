import path from 'path';

/** Escape a path for a PowerShell double-quoted string literal. */
export function quotePathForPowerShell(filePath: string): string {
  const escaped = filePath.replace(/`/g, '``').replace(/"/g, '`"');
  return `"${escaped}"`;
}

/** Mastyf AI proxy wrapper script for the current platform. */
export function resolveMastyfAiProxyWrapper(projectRoot: string): string {
  if (process.platform === 'win32') {
    return path.join(projectRoot, 'scripts', 'mastyf-ai-proxy.ps1');
  }
  return path.join(projectRoot, 'scripts', 'mastyf-ai-proxy.sh');
}

export interface WrappedMcpServerEntry {
  /** VS Code requires this; other clients ignore it. */
  type?: 'stdio';
  command: string;
  args: string[];
  transport: 'stdio';
  env?: Record<string, string>;
}

/** MCP client JSON entry for a wrapped upstream server (handles paths with spaces). */
export function buildWrappedMcpServerEntry(
  projectRoot: string,
  singleConfigPath: string,
  policyPath: string,
  extraEnv?: Record<string, string>,
  nodeCommand?: string,
): WrappedMcpServerEntry {
  const wrapperScript = resolveMastyfAiProxyWrapper(projectRoot);
  const proxyArgs = ['--config', singleConfigPath, '--policy', policyPath];
  const env = extraEnv && Object.keys(extraEnv).length > 0 ? { env: extraEnv } : {};

  if (nodeCommand) {
    return {
      command: nodeCommand,
      args: [path.join(projectRoot, 'dist', 'cli.js'), 'proxy', ...proxyArgs, '--blocking-mode', 'block'],
      transport: 'stdio',
      type: 'stdio',
      // One proxy per server: without this, UI-managed servers get merged in and the start fails.
      env: { ...extraEnv, MASTYF_AI_FLEET_CHILD: 'true' },
    };
  }

  if (process.platform === 'win32') {
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapperScript, ...proxyArgs],
      transport: 'stdio',
      ...env,
    };
  }

  return {
    command: wrapperScript,
    args: proxyArgs,
    transport: 'stdio',
    ...env,
  };
}

/** Whether a server config already points at Mastyf AI proxy. */
export function isMastyfAiProxyCommand(command: string): boolean {
  return (
    command.includes('mastyf-ai-proxy') ||
    command.includes('mastyf-ai') ||
    /mastyf-ai-proxy\.ps1$/i.test(command)
  );
}
