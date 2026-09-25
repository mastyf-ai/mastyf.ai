import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { ConfigParser } from '../config-parser.js';
import { readOnboardArtifact } from '../cli/onboard.js';
import { loadUiMcpServers } from '../utils/mcp-server-config.js';
import { isStreamableHttpMcpUrl } from '../utils/mcp-transport-url.js';
import { isMastyfAiProxyCommand } from '../utils/windows-paths.js';
export function resolveWorkspaceRoot(explicit) {
    if (explicit)
        return resolve(explicit);
    const onboard = readOnboardArtifact();
    if (onboard?.configsDir) {
        return resolve(dirname(onboard.configsDir));
    }
    return resolve(process.cwd());
}
export function configsDir(workspaceRoot) {
    return join(resolveWorkspaceRoot(workspaceRoot), 'mastyf-ai-configs');
}
function sanitizeFileName(name) {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}
function classifyTransport(config) {
    if (config.transport === 'websocket')
        return 'websocket';
    if (config.url) {
        return isStreamableHttpMcpUrl(config.url) ? 'streamable' : 'sse';
    }
    return 'stdio';
}
function isWrappedConfig(config) {
    if (!config.command)
        return false;
    if (isMastyfAiProxyCommand(config.command))
        return true;
    return (config.args ?? []).includes('proxy');
}
function loadWrappedConfigs(workspaceRoot) {
    const dir = configsDir(workspaceRoot);
    if (!existsSync(dir))
        return [];
    const entries = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'fleet-manifest-remote.json')) {
        const configPath = join(dir, file);
        try {
            const parsed = ConfigParser.parse(configPath);
            for (const s of parsed) {
                entries.push({
                    name: s.name,
                    transport: classifyTransport(s),
                    source: 'wrapped',
                    wrapped: isWrappedConfig(s) || true,
                    config: s,
                    configPath,
                });
            }
        }
        catch {
            /* skip malformed */
        }
    }
    return entries;
}
function loadIdeConfigs() {
    const paths = ConfigParser.findConfigPaths();
    const entries = [];
    const seen = new Set();
    for (const p of paths) {
        try {
            const parsed = ConfigParser.parse(p);
            for (const s of parsed) {
                if (seen.has(s.name))
                    continue;
                if (isWrappedConfig(s))
                    continue;
                if (!s.command && !s.url)
                    continue;
                seen.add(s.name);
                entries.push({
                    name: s.name,
                    transport: classifyTransport(s),
                    source: 'ide',
                    wrapped: false,
                    config: s,
                });
            }
        }
        catch {
            /* skip */
        }
    }
    return entries;
}
/**
 * Discover all MCP servers. Priority on name collision: UI > wrapped > IDE.
 */
export function discoverAllServers(opts = {}) {
    const workspaceRoot = resolveWorkspaceRoot(opts.workspaceRoot);
    const byName = new Map();
    if (opts.includeIde !== false) {
        for (const e of loadIdeConfigs()) {
            if (!byName.has(e.name))
                byName.set(e.name, e);
        }
    }
    for (const e of loadWrappedConfigs(workspaceRoot)) {
        byName.set(e.name, e);
    }
    for (const s of loadUiMcpServers()) {
        byName.set(s.name, {
            name: s.name,
            transport: classifyTransport(s),
            source: 'ui',
            wrapped: false,
            config: s,
        });
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export function isStdioUpstream(entry) {
    return entry.transport === 'stdio' && Boolean(entry.config.command);
}
export function isRemoteUpstream(entry) {
    return entry.transport === 'sse' || entry.transport === 'streamable' || entry.transport === 'websocket';
}
/** Write a single-server mcpServers JSON under mastyf-ai-configs/. */
export function materializeServerConfig(entry, workspaceRoot) {
    const dir = configsDir(workspaceRoot);
    mkdirSync(dir, { recursive: true });
    const safeName = sanitizeFileName(entry.name);
    const configPath = join(dir, `${safeName}.json`);
    const cfg = entry.config;
    const upstream = {};
    if (cfg.command) {
        upstream.command = cfg.command;
        upstream.args = cfg.args ?? [];
        upstream.transport = cfg.transport ?? 'stdio';
    }
    else if (cfg.url) {
        upstream.url = cfg.url;
        upstream.transport = cfg.transport ?? 'sse';
    }
    if (cfg.env && Object.keys(cfg.env).length > 0)
        upstream.env = cfg.env;
    writeFileSync(configPath, JSON.stringify({ mcpServers: { [entry.name]: upstream } }, null, 2) + '\n', 'utf-8');
    return configPath;
}
/** Merge remote-only servers into one manifest for a coordinator proxy child. */
export function materializeRemoteFleetManifest(entries, workspaceRoot, portByName) {
    const remotes = entries.filter(isRemoteUpstream);
    if (remotes.length === 0)
        return null;
    const dir = configsDir(workspaceRoot);
    mkdirSync(dir, { recursive: true });
    const manifestPath = join(dir, 'fleet-manifest-remote.json');
    const mcpServers = {};
    for (const e of remotes) {
        const cfg = e.config;
        const upstream = { url: cfg.url, transport: cfg.transport ?? 'sse' };
        const env = { ...(cfg.env ?? {}) };
        const assigned = portByName?.get(e.name);
        if (assigned) {
            env.MASTYF_AI_STREAMABLE_HTTP_PORT = String(assigned);
            env.MASTYF_AI_SSE_PROXY_PORT = String(assigned);
        }
        if (Object.keys(env).length > 0)
            upstream.env = env;
        mcpServers[e.name] = upstream;
    }
    writeFileSync(manifestPath, JSON.stringify({ mcpServers }, null, 2) + '\n', 'utf-8');
    return manifestPath;
}
export function fleetEntryFromMcpConfig(config, source = 'ui') {
    return {
        name: config.name,
        transport: classifyTransport(config),
        source,
        wrapped: false,
        config,
    };
}
//# sourceMappingURL=unified-server-registry.js.map