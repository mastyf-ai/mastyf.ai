import { realpathSync } from 'fs';
import { homedir, platform, tmpdir } from 'os';
import { resolve as pathResolve } from 'path';
import { Logger } from './logger.js';
function comparePath(p) {
    const resolved = pathResolve(p);
    return platform() === 'win32' ? resolved.toLowerCase() : resolved;
}
function resolvedTempPrefix() {
    try {
        return comparePath(realpathSync(tmpdir()));
    }
    catch {
        return comparePath(tmpdir());
    }
}
function unixAllowedPrefixes(home, cwd) {
    const temp = resolvedTempPrefix();
    return [
        home,
        cwd,
        temp,
        '/tmp/',
        '/var/',
        '/etc/',
        '/opt/',
        '/home/',
        '/root/',
        '/srv/',
        '/data/',
        '/Users/',
        '/github/workspace/',
        '/runner/',
    ].map(comparePath);
}
function winAllowedPrefixes(home, cwd) {
    const roots = ['c:\\', 'd:\\', process.env['PROGRAMDATA'], process.env['PUBLIC']]
        .filter((r) => Boolean(r))
        .map((r) => comparePath(r.endsWith('\\') ? r : `${r}\\`));
    return [comparePath(home), comparePath(cwd), ...roots];
}
function isUnderAllowedPrefix(resolved, prefixes) {
    const norm = comparePath(resolved);
    const withSep = norm.endsWith('\\') || norm.endsWith('/') ? norm : `${norm}${platform() === 'win32' ? '\\' : '/'}`;
    return prefixes.some((prefix) => {
        if (norm === prefix.replace(/[\\/]+$/, ''))
            return true;
        const p = prefix.endsWith('\\') || prefix.endsWith('/') ? prefix : `${prefix}${platform() === 'win32' ? '\\' : '/'}`;
        return withSep.startsWith(p) || norm.startsWith(prefix);
    });
}
/**
 * Sanitise user-supplied configPath to prevent path-traversal and symlink escape.
 * Resolves symlinks via realpath; allows home, CWD, and common MCP/CI locations.
 */
export function sanitizeConfigPath(input) {
    if (!input || typeof input !== 'string')
        return null;
    if (input.includes('..')) {
        Logger.warn(`[mastyf-ai] Path-traversal attempt blocked: ${input}`);
        return null;
    }
    let resolved;
    try {
        resolved = realpathSync(pathResolve(input));
    }
    catch {
        Logger.warn(`[mastyf-ai] Config path does not exist or is inaccessible: ${input}`);
        return null;
    }
    const home = pathResolve(homedir());
    const cwd = pathResolve('.');
    const prefixes = platform() === 'win32' ? winAllowedPrefixes(home, cwd) : unixAllowedPrefixes(home, cwd);
    if (isUnderAllowedPrefix(resolved, prefixes)) {
        return resolved;
    }
    Logger.warn(`[mastyf-ai] Config path rejected (outside allowed directories): ${input}`);
    return null;
}
//# sourceMappingURL=sanitize-config-path.js.map