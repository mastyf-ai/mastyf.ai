import path from 'path';

/** Escape a path for a PowerShell double-quoted string literal. */
export function quotePathForPowerShell(filePath: string): string {
  const escaped = filePath.replace(/`/g, '``').replace(/"/g, '`"');
  return `"${escaped}"`;
}

/** Guardian proxy wrapper script for the current platform. */
export function resolveGuardianProxyWrapper(projectRoot: string): string {
  if (process.platform === 'win32') {
    return path.join(projectRoot, 'guardian-proxy.ps1');
  }
  return path.join(projectRoot, 'scripts', 'guardian-proxy.sh');
}

export interface WrappedMcpServerEntry {
  command: string;
  args: string[];
  transport: 'stdio';
}

/** MCP client JSON entry for a wrapped upstream server (handles paths with spaces). */
export function buildWrappedMcpServerEntry(
  projectRoot: string,
  singleConfigPath: string,
  policyPath: string,
): WrappedMcpServerEntry {
  const wrapperScript = resolveGuardianProxyWrapper(projectRoot);
  const proxyArgs = ['--config', singleConfigPath, '--policy', policyPath];

  if (process.platform === 'win32') {
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapperScript, ...proxyArgs],
      transport: 'stdio',
    };
  }

  return {
    command: wrapperScript,
    args: proxyArgs,
    transport: 'stdio',
  };
}

/** Whether a server config already points at Guardian proxy. */
export function isGuardianProxyCommand(command: string): boolean {
  return (
    command.includes('guardian-proxy') ||
    command.includes('mcp-guardian') ||
    /guardian-proxy\.ps1$/i.test(command)
  );
}
