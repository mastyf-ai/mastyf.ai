/**
 * Resolve a single-stdio-server Mastyf AI MCP config JSON for proxy/start.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readOnboardArtifact } from '../cli/onboard.js';
function countStdioServers(cfg) {
    const servers = Object.values(cfg.mcpServers || cfg.servers || {});
    return servers.filter((s) => s && (s.command || s.transport === 'stdio')).length;
}
function tryConfigPath(absPath) {
    if (!existsSync(absPath))
        return null;
    try {
        const cfg = JSON.parse(readFileSync(absPath, 'utf-8'));
        if (countStdioServers(cfg) === 1)
            return absPath;
    }
    catch {
        /* invalid json */
    }
    return null;
}
function listJsonConfigs(dir) {
    if (!existsSync(dir))
        return [];
    return readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => join(dir, f));
}
/**
 * Pick first valid single-stdio-server mastyf-ai config.
 * Priority: explicit path → onboard configsDir (optional) → mastyf-ai-configs under search roots.
 */
export function pickMastyfAiConfig(opts = {}) {
    if (opts.configPath) {
        const abs = resolve(opts.configPath);
        return tryConfigPath(abs);
    }
    const includeOnboard = opts.includeOnboard !== false;
    if (includeOnboard) {
        const onboard = readOnboardArtifact();
        if (onboard?.configsDir) {
            for (const p of listJsonConfigs(onboard.configsDir)) {
                const hit = tryConfigPath(p);
                if (hit)
                    return hit;
            }
        }
    }
    const roots = opts.searchRoots?.length ? opts.searchRoots : [process.cwd()];
    const seen = new Set();
    for (const root of roots) {
        const candidates = [
            join(root, 'mastyf-ai-configs', 'filesystem.json'),
            ...listJsonConfigs(join(root, 'mastyf-ai-configs')),
        ];
        for (const p of candidates) {
            if (seen.has(p))
                continue;
            seen.add(p);
            const hit = tryConfigPath(p);
            if (hit)
                return hit;
        }
    }
    return null;
}
