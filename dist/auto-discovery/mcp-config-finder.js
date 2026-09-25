/**
 * MCP Configuration Auto-Discovery Finder
 *
 * Scans standard developer workstation paths to automatically discover
 * and onboard MCP server configurations from:
 *   - Cursor (~/.cursor/mcp.json)
 *   - Claude Desktop (macOS / Linux / Windows config locations)
 *   - Cline (~/.config/cline/mcp_config.json)
 *   - Windsurf (~/.windsurf/mcp.json)
 *   - VS Code (.vscode/mcp.json)
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
export class McpConfigFinder {
    /**
     * Returns a list of candidate config paths across supported AI agent clients.
     */
    getCandidatePaths() {
        const home = os.homedir();
        const platform = os.platform();
        const candidates = [
            // Cursor
            { client: 'Cursor', configPath: path.join(home, '.cursor', 'mcp.json') },
            // Cline
            { client: 'Cline', configPath: path.join(home, '.config', 'cline', 'mcp_config.json') },
            // Windsurf
            { client: 'Windsurf', configPath: path.join(home, '.windsurf', 'mcp.json') },
            // VS Code root/workspace
            { client: 'VS Code', configPath: path.join(process.cwd(), '.vscode', 'mcp.json') },
        ];
        // Claude Desktop (OS-specific locations)
        if (platform === 'darwin') {
            candidates.push({
                client: 'Claude Desktop',
                configPath: path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
            });
        }
        else if (platform === 'win32') {
            const appData = process.env['APPDATA'] || path.join(home, 'AppData', 'Roaming');
            candidates.push({
                client: 'Claude Desktop',
                configPath: path.join(appData, 'Claude', 'claude_desktop_config.json'),
            });
        }
        else {
            candidates.push({
                client: 'Claude Desktop',
                configPath: path.join(home, '.config', 'Claude', 'claude_desktop_config.json'),
            });
        }
        return candidates;
    }
    /**
     * Parses an MCP client configuration file into standardized server entries.
     */
    parseConfigFile(client, configPath) {
        if (!fs.existsSync(configPath)) {
            return null;
        }
        try {
            const content = fs.readFileSync(configPath, 'utf8');
            const parsed = JSON.parse(content);
            const rawServers = (parsed['mcpServers'] || parsed['servers'] || {});
            const servers = [];
            for (const [name, cfg] of Object.entries(rawServers)) {
                if (typeof cfg !== 'object' || cfg === null)
                    continue;
                servers.push({
                    name,
                    command: typeof cfg['command'] === 'string' ? cfg['command'] : undefined,
                    args: Array.isArray(cfg['args']) ? cfg['args'] : undefined,
                    env: typeof cfg['env'] === 'object' && cfg['env'] !== null ? cfg['env'] : undefined,
                    transport: typeof cfg['transport'] === 'string' ? cfg['transport'] : 'stdio',
                    url: typeof cfg['url'] === 'string' ? cfg['url'] : undefined,
                });
            }
            return {
                client,
                configPath,
                servers,
            };
        }
        catch {
            return null;
        }
    }
    /**
     * Discovers all active MCP client configurations on the host machine.
     */
    discoverAll() {
        const candidates = this.getCandidatePaths();
        const results = [];
        for (const { client, configPath } of candidates) {
            const discovered = this.parseConfigFile(client, configPath);
            if (discovered && discovered.servers.length > 0) {
                results.push(discovered);
            }
        }
        return results;
    }
}
export const globalMcpConfigFinder = new McpConfigFinder();
//# sourceMappingURL=mcp-config-finder.js.map