/**
 * The copy of the proxy that wrapped agents run. `npx` caches get purged, so agent configs must
 * point somewhere durable: ~/.mastyf-ai/runtime.
 */
import crossSpawn from 'cross-spawn';
import fs from 'node:fs';
import path from 'node:path';

function npmInstall(dir: string, spec: string): void {
  const res = crossSpawn.sync('npm', ['install', '--prefix', dir, '--no-audit', '--no-fund', spec], { stdio: 'inherit' });
  if (res.status !== 0) throw new Error(`Could not install ${spec} (npm exited ${res.status ?? 'without a status'})`);
}

function installedVersion(pkgRoot: string): string | null {
  try {
    return (JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

/** Installs the given server version if needed and returns its package root. */
export function ensureRuntime(opts: {
  home: string;
  version: string;
  install?: (dir: string, spec: string) => void;
}): string {
  const dir = path.join(opts.home, '.mastyf-ai', 'runtime');
  const pkgRoot = path.join(dir, 'node_modules', '@mastyf_ai', 'server');
  if (installedVersion(pkgRoot) === opts.version && fs.existsSync(path.join(pkgRoot, 'dist', 'cli.js'))) return pkgRoot;
  fs.mkdirSync(dir, { recursive: true });
  (opts.install ?? npmInstall)(dir, `@mastyf_ai/server@${opts.version}`);
  if (!fs.existsSync(path.join(pkgRoot, 'dist', 'cli.js'))) throw new Error(`Install finished but ${pkgRoot} has no dist/cli.js`);
  return pkgRoot;
}
