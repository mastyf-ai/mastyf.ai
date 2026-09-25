import { homedir } from 'os';
import { join } from 'path';
const DEFAULT_DB_PATH = join(homedir(), '.mastyf-ai', 'history.db');
const MCP_SERVER_DB_PATH = join(homedir(), '.mastyf-ai', 'mcp-server.db');
/** Canonical SQLite path for all Mastyf AI processes (proxy, TUI, scan, audit). */
export function resolveMastyfAiDbPath(explicit) {
    if (explicit === ':memory:')
        return ':memory:';
    return explicit ?? process.env['MASTYF_AI_DB_PATH'] ?? DEFAULT_DB_PATH;
}
export function getDefaultMastyfAiDbPath() {
    return DEFAULT_DB_PATH;
}
/**
 * MCP stdio server DB (Cline cannot pass env) — separate file from proxy history to avoid locks.
 */
export function resolveMcpServerDbPath() {
    return process.env['MASTYF_AI_DB_PATH'] ?? MCP_SERVER_DB_PATH;
}
//# sourceMappingURL=mastyf-ai-db-path.js.map