/**
 * Generate per-server mastyf-ai-configs and optional patched client MCP JSON.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ConfigParser } from '../config-parser.js';
import { buildWrappedMcpServerEntry, isMastyfAiProxyCommand, resolveMastyfAiProxyWrapper, } from '../utils/windows-paths.js';
import { isRemoteSshEnabled } from '../utils/remote-path.js';
const CLIENT_PATHS = {
    cline: [
        path.join(os.homedir(), 'Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json'),
        path.join(os.homedir(), '.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json'),
        path.join(os.homedir(), 'AppData/Roaming/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json'),
    ],
    cursor: [path.join(os.homedir(), '.cursor/mcp.json')],
    'claude-desktop': [
        path.join(os.homedir(), 'Library/Application Support/Claude/claude_desktop_config.json'),
        path.join(os.homedir(), '.config/Claude/claude_desktop_config.json'),
        path.join(os.homedir(), 'AppData/Roaming/Claude/claude_desktop_config.json'),
    ],
    windsurf: [path.join(os.homedir(), '.codeium/windsurf/mcp_config.json')],
};
const DEFAULT_SKIP = new Set(['mastyf-ai', 'mastyf-ai']);
export function resolveClientConfigPath(client, explicit) {
    if (explicit) {
        return fs.existsSync(explicit) ? path.resolve(explicit) : null;
    }
    if (client === 'auto') {
        const found = ConfigParser.findConfigPaths();
        return found[0] ?? null;
    }
    for (const p of CLIENT_PATHS[client]) {
        if (fs.existsSync(p))
            return p;
    }
    return null;
}
function isAlreadyWrapped(server) {
    const args = server.args ?? [];
    if (args.includes('proxy'))
        return true;
    const cmd = server.command ?? '';
    return isMastyfAiProxyCommand(cmd);
}
function sanitizeFileName(name) {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}
function readClientJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}
function extractServers(raw) {
    if (raw.mcpServers && typeof raw.mcpServers === 'object') {
        return raw.mcpServers;
    }
    if (raw.servers && typeof raw.servers === 'object') {
        return raw.servers;
    }
    return raw;
}
function setServers(raw, servers) {
    if ('mcpServers' in raw || !('servers' in raw)) {
        raw.mcpServers = servers;
    }
    else {
        raw.servers = servers;
    }
}
export function runWrap(opts) {
    const clientPath = resolveClientConfigPath(opts.client, opts.configPath);
    if (!clientPath) {
        throw new Error(`No MCP config found for client "${opts.client}". Use --config <path> or install Cline/Cursor first.`);
    }
    const installRoot = path.resolve(opts.projectRoot);
    const workspaceRoot = path.resolve(opts.workspaceRoot ?? opts.projectRoot);
    const configsDir = path.join(workspaceRoot, 'mastyf-ai-configs');
    const wrapperScript = resolveMastyfAiProxyWrapper(installRoot);
    const policyCandidates = path.isAbsolute(opts.policyPath)
        ? [opts.policyPath]
        : [
            path.join(installRoot, opts.policyPath),
            path.join(installRoot, 'default-policy.yaml'),
        ];
    const policyPath = policyCandidates.find((p) => fs.existsSync(p));
    if (!policyPath) {
        throw new Error(`Policy file not found: tried ${policyCandidates.join(', ')}`);
    }
    if (!fs.existsSync(path.join(installRoot, 'dist/cli.js'))) {
        throw new Error(`Build required: dist/cli.js not found under ${installRoot}. Reinstall @mastyf_ai/server or run pnpm build in the repo.`);
    }
    if (!fs.existsSync(wrapperScript)) {
        throw new Error(`Wrapper script missing: ${wrapperScript}`);
    }
    if (!fs.existsSync(policyPath)) {
        throw new Error(`Policy file not found: ${policyPath}`);
    }
    const skip = new Set([...(opts.skipNames ?? []), ...DEFAULT_SKIP]);
    const servers = ConfigParser.parse(clientPath);
    const raw = readClientJson(clientPath);
    const serverMap = extractServers(raw);
    fs.mkdirSync(configsDir, { recursive: true });
    const remoteEnv = (() => {
        if (!isRemoteSshEnabled())
            return undefined;
        const env = { MASTYF_AI_REMOTE_SSH: 'true' };
        if (process.env.MASTYF_AI_REMOTE_PATH_MAP) {
            env.MASTYF_AI_REMOTE_PATH_MAP = process.env.MASTYF_AI_REMOTE_PATH_MAP;
        }
        if (process.env.MASTYF_AI_WORKSPACE) {
            env.MASTYF_AI_WORKSPACE = process.env.MASTYF_AI_WORKSPACE;
        }
        return env;
    })();
    const wrapped = [];
    const skipped = [];
    for (const server of servers) {
        if (skip.has(server.name)) {
            skipped.push(`${server.name} (mastyf-ai meta-server)`);
            continue;
        }
        if (isAlreadyWrapped(server)) {
            skipped.push(`${server.name} (already wrapped)`);
            continue;
        }
        if (!server.command) {
            skipped.push(`${server.name} (SSE/url-only)`);
            continue;
        }
        const safeName = sanitizeFileName(server.name);
        const singleConfigPath = path.join(configsDir, `${safeName}.json`);
        const upstream = {
            command: server.command,
            args: server.args ?? [],
            transport: server.transport ?? 'stdio',
        };
        if (server.env && Object.keys(server.env).length > 0) {
            upstream.env = server.env;
        }
        if (server.url)
            upstream.url = server.url;
        fs.writeFileSync(singleConfigPath, JSON.stringify({ mcpServers: { [server.name]: upstream } }, null, 2) + '\n', 'utf-8');
        serverMap[server.name] = buildWrappedMcpServerEntry(installRoot, singleConfigPath, policyPath, remoteEnv);
        wrapped.push(server.name);
    }
    let backupPath;
    if (opts.apply && wrapped.length > 0) {
        backupPath = `${clientPath}.bak.${Date.now()}`;
        fs.copyFileSync(clientPath, backupPath);
        setServers(raw, serverMap);
        fs.writeFileSync(clientPath, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
    }
    const examplePath = path.join(workspaceRoot, 'examples', `${path.basename(clientPath, '.json')}.wrapped.json`);
    fs.mkdirSync(path.dirname(examplePath), { recursive: true });
    const exampleRaw = readClientJson(clientPath);
    const exampleMap = extractServers(exampleRaw);
    for (const name of wrapped) {
        const safeName = sanitizeFileName(name);
        const singleConfigPath = path.join(configsDir, `${safeName}.json`);
        exampleMap[name] = buildWrappedMcpServerEntry(installRoot, singleConfigPath, policyPath, remoteEnv);
    }
    setServers(exampleRaw, exampleMap);
    fs.writeFileSync(examplePath, JSON.stringify(exampleRaw, null, 2) + '\n', 'utf-8');
    return {
        clientConfigPath: clientPath,
        backupPath,
        configsDir,
        wrapped,
        skipped,
        wrapperScript,
    };
}
const DEFAULT_SKIP_PATCH = new Set(['mastyf-ai', 'mastyf-ai']);
/**
 * Patch IDE MCP config so fleet servers use local HTTP URLs (Fleet Hub mode).
 */
export function patchClientToLocalUrls(opts) {
    const clientPath = resolveClientConfigPath(opts.client, opts.configPath);
    if (!clientPath) {
        throw new Error(`No MCP config found for client "${opts.client}".`);
    }
    const skip = new Set([...(opts.skipNames ?? []), ...DEFAULT_SKIP_PATCH]);
    const raw = readClientJson(clientPath);
    const serverMap = extractServers(raw);
    const patched = [];
    for (const { name, localUrl } of opts.entries) {
        if (skip.has(name))
            continue;
        serverMap[name] = { url: localUrl };
        patched.push(name);
    }
    let backupPath;
    if (opts.apply && patched.length > 0) {
        backupPath = `${clientPath}.bak.${Date.now()}`;
        fs.copyFileSync(clientPath, backupPath);
        setServers(raw, serverMap);
        fs.writeFileSync(clientPath, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
    }
    return { clientConfigPath: clientPath, backupPath, patched };
}
export function patchClientServerToLocalUrl(opts) {
    const result = patchClientToLocalUrls({
        client: opts.client,
        configPath: opts.configPath,
        entries: [{ name: opts.name, localUrl: opts.localUrl }],
        apply: opts.apply,
    });
    return { clientConfigPath: result.clientConfigPath, backupPath: result.backupPath };
}
//# sourceMappingURL=client-wrap.js.map