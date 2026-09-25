import path from 'path';
/** Escape a path for a PowerShell double-quoted string literal. */
export function quotePathForPowerShell(filePath) {
    const escaped = filePath.replace(/`/g, '``').replace(/"/g, '`"');
    return `"${escaped}"`;
}
/** Mastyf AI proxy wrapper script for the current platform. */
export function resolveMastyfAiProxyWrapper(projectRoot) {
    if (process.platform === 'win32') {
        return path.join(projectRoot, 'mastyf-ai-proxy.ps1');
    }
    return path.join(projectRoot, 'scripts', 'mastyf-ai-proxy.sh');
}
/** MCP client JSON entry for a wrapped upstream server (handles paths with spaces). */
export function buildWrappedMcpServerEntry(projectRoot, singleConfigPath, policyPath, extraEnv) {
    const wrapperScript = resolveMastyfAiProxyWrapper(projectRoot);
    const proxyArgs = ['--config', singleConfigPath, '--policy', policyPath];
    const env = extraEnv && Object.keys(extraEnv).length > 0 ? { env: extraEnv } : {};
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
export function isMastyfAiProxyCommand(command) {
    return (command.includes('mastyf-ai-proxy') ||
        command.includes('mastyf-ai') ||
        /mastyf-ai-proxy\.ps1$/i.test(command));
}
