import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
const CONFIG_DIR = join(homedir(), '.mastyf-ai');
const CONFIG_PATH = process.env.MASTYF_AI_SERVERS_JSON_PATH || join(CONFIG_DIR, 'servers.json');
function ensureDir() {
    if (!existsSync(CONFIG_DIR))
        mkdirSync(CONFIG_DIR, { recursive: true });
}
function readConfig() {
    try {
        if (!existsSync(CONFIG_PATH))
            return [];
        const raw = readFileSync(CONFIG_PATH, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return [];
    }
}
function writeConfig(servers) {
    ensureDir();
    writeFileSync(CONFIG_PATH, JSON.stringify(servers, null, 2));
}
export function listUiServers() {
    return readConfig();
}
export function uiServerToMcpConfig(ui) {
    if (ui.disabled)
        return null;
    const transport = ui.transport ?? (ui.url ? 'sse' : 'stdio');
    if (transport === 'stdio') {
        if (!ui.command)
            return null;
        return {
            name: ui.name,
            command: ui.command,
            args: ui.args ?? [],
            env: ui.env,
            transport: 'stdio',
        };
    }
    if (!ui.url)
        return null;
    return {
        name: ui.name,
        args: ui.args?.length ? ui.args : undefined,
        env: ui.env,
        url: ui.url,
        transport: 'sse',
    };
}
export function loadUiMcpServers() {
    return readConfig()
        .map(uiServerToMcpConfig)
        .filter((s) => s !== null);
}
/** UI-managed servers from ~/.mastyf-ai/servers.json override CLI entries by name. */
export function mergeCliAndUiServers(cliServers) {
    const uiByName = new Map(loadUiMcpServers().map((s) => [s.name, s]));
    const merged = cliServers.map((cli) => uiByName.get(cli.name) ?? cli);
    const cliNames = new Set(cliServers.map((s) => s.name));
    for (const [name, ui] of uiByName) {
        if (!cliNames.has(name))
            merged.push(ui);
    }
    return merged;
}
export function addUiServer(config) {
    if (!config.name) {
        return { ok: false, error: 'name is required' };
    }
    const transport = config.transport ?? 'stdio';
    if (transport === 'stdio' && !config.command) {
        return { ok: false, error: 'command is required for stdio transport' };
    }
    if (transport !== 'stdio' && !config.url) {
        return { ok: false, error: 'url is required for SSE/streamable HTTP transport' };
    }
    const servers = readConfig();
    if (servers.some((s) => s.name === config.name)) {
        return { ok: false, error: `Server "${config.name}" already exists` };
    }
    servers.push({
        name: config.name,
        command: config.command,
        args: config.args ?? [],
        env: config.env,
        transport: transport,
        url: config.url,
        disabled: config.disabled ?? false,
    });
    writeConfig(servers);
    return { ok: true };
}
export function removeUiServer(name) {
    const servers = readConfig();
    const idx = servers.findIndex((s) => s.name === name);
    if (idx === -1) {
        return { ok: false, error: `Server "${name}" not found` };
    }
    servers.splice(idx, 1);
    writeConfig(servers);
    return { ok: true };
}
export function updateUiServer(name, config) {
    const servers = readConfig();
    const existing = servers.find((s) => s.name === name);
    if (!existing) {
        return { ok: false, error: `Server "${name}" not found` };
    }
    Object.assign(existing, config);
    writeConfig(servers);
    return { ok: true };
}
/** Generate a full mcpServers-compatible JSON object from UI configs */
export function buildMcpServersConfig() {
    const ui = readConfig();
    const mcpServers = {};
    for (const s of ui) {
        if (s.disabled)
            continue;
        mcpServers[s.name] = {
            command: s.command,
            args: s.args,
            ...(s.env ? { env: s.env } : {}),
        };
    }
    return { mcpServers };
}
//# sourceMappingURL=mcp-server-config.js.map