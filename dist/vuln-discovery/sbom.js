/**
 * SBOM helpers for MCP server package roots — locate lockfiles and emit CycloneDX-lite.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
const LOCK_NAMES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'];
/** Walk up from start looking for a lockfile; also check common install roots. */
export function findLockfileNear(startPath, maxUp = 4) {
    let cur = resolve(startPath);
    for (let i = 0; i < maxUp; i++) {
        for (const name of LOCK_NAMES) {
            const p = join(cur, name);
            if (existsSync(p))
                return p;
        }
        const parent = dirname(cur);
        if (parent === cur)
            break;
        cur = parent;
    }
    return null;
}
/** Infer install root from MCP server command/args (npx package path or local script). */
export function resolveServerPackageRoot(server) {
    if (server.packageName) {
        // Prefer node_modules lookup relative to cwd
        const nm = join(process.cwd(), 'node_modules', ...server.packageName.split('/'));
        if (existsSync(nm))
            return nm;
    }
    const args = server.args ?? [];
    for (const a of args) {
        if (a.endsWith('.js') || a.endsWith('.mjs') || a.endsWith('.cjs')) {
            const dir = dirname(resolve(a));
            if (existsSync(dir))
                return dir;
        }
    }
    if (server.command && (server.command.includes('/') || server.command.includes('\\'))) {
        try {
            if (existsSync(server.command))
                return dirname(resolve(server.command));
        }
        catch {
            /* ignore */
        }
    }
    return null;
}
function parsePackageLock(lockPath) {
    try {
        const raw = JSON.parse(readFileSync(lockPath, 'utf-8'));
        const out = [];
        if (raw.packages) {
            for (const [key, info] of Object.entries(raw.packages)) {
                if (!key || key === '')
                    continue;
                const name = key.replace(/^node_modules\//, '');
                if (!info.version)
                    continue;
                out.push({
                    name,
                    version: info.version,
                    purl: `pkg:npm/${name}@${info.version}`,
                });
            }
        }
        else if (raw.dependencies) {
            for (const [name, info] of Object.entries(raw.dependencies)) {
                if (!info.version)
                    continue;
                out.push({ name, version: info.version, purl: `pkg:npm/${name}@${info.version}` });
            }
        }
        return out.slice(0, 500);
    }
    catch {
        return [];
    }
}
function parsePnpmLock(lockPath) {
    try {
        const text = readFileSync(lockPath, 'utf-8');
        const out = [];
        // Minimal parse: packages: section keys like /foo@1.2.3:
        const re = /(?:^|\n)\s{2}'?\/?(@?[^@'\s]+)@([^':\s]+)'?:/g;
        let m;
        while ((m = re.exec(text)) !== null && out.length < 500) {
            out.push({
                name: m[1],
                version: m[2],
                purl: `pkg:npm/${m[1]}@${m[2]}`,
            });
        }
        return out;
    }
    catch {
        return [];
    }
}
export function buildSbomForServer(server) {
    const root = resolveServerPackageRoot(server);
    const lock = (root ? findLockfileNear(root) : null) ||
        findLockfileNear(process.cwd());
    if (!lock)
        return null;
    const components = lock.endsWith('pnpm-lock.yaml')
        ? parsePnpmLock(lock)
        : lock.endsWith('package-lock.json')
            ? parsePackageLock(lock)
            : [];
    if (!components.length)
        return null;
    return {
        bomFormat: 'CycloneDX',
        specVersion: '1.5',
        serialNumber: `urn:uuid:mastyf-${server.name}-${Date.now()}`,
        version: 1,
        metadata: {
            timestamp: new Date().toISOString(),
            component: { name: server.name, type: 'application' },
        },
        components,
    };
}
export function saveSbom(serverName, sbom) {
    const dir = join(homedir(), '.mastyf-ai', 'sbom');
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    const path = join(dir, `${serverName.replace(/[^a-zA-Z0-9._-]/g, '_')}.cdx.json`);
    writeFileSync(path, JSON.stringify(sbom, null, 2));
    return path;
}
export function loadSbom(serverName) {
    const path = join(homedir(), '.mastyf-ai', 'sbom', `${serverName.replace(/[^a-zA-Z0-9._-]/g, '_')}.cdx.json`);
    if (!existsSync(path))
        return null;
    try {
        return JSON.parse(readFileSync(path, 'utf-8'));
    }
    catch {
        return null;
    }
}
/** Diff previous vs current SBOM component sets — returns added/removed name@version. */
export function diffSbom(prev, next) {
    const prevSet = new Set((prev?.components || []).map((c) => `${c.name}@${c.version}`));
    const nextSet = new Set(next.components.map((c) => `${c.name}@${c.version}`));
    const added = [...nextSet].filter((x) => !prevSet.has(x));
    const removed = [...prevSet].filter((x) => !nextSet.has(x));
    return { added, removed };
}
export function listSbomServerNames() {
    const dir = join(homedir(), '.mastyf-ai', 'sbom');
    if (!existsSync(dir))
        return [];
    return readdirSync(dir)
        .filter((f) => f.endsWith('.cdx.json'))
        .map((f) => f.replace(/\.cdx\.json$/, ''));
}
//# sourceMappingURL=sbom.js.map