import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let cachedInstallRoot: string | null = null;

/**
 * Directory containing dist/cli.js (git clone or global npm @mastyf_ai/server).
 * Not the process cwd — use workspaceRoot for mastyf-ai-configs output.
 */
export function resolveMastyfAiInstallRoot(): string {
  if (cachedInstallRoot) return cachedInstallRoot;

  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth++) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string };
        if (pkg.name === '@mastyf_ai/server' && existsSync(join(dir, 'dist', 'cli.js'))) {
          cachedInstallRoot = dir;
          return dir;
        }
      } catch {
        /* try parent */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const cwd = process.cwd();
  if (existsSync(join(cwd, 'dist', 'cli.js'))) {
    cachedInstallRoot = cwd;
    return cwd;
  }

  cachedInstallRoot = cwd;
  return cwd;
}

/** Reset cache (tests only). */
export function resetMastyfAiInstallRootCache(): void {
  cachedInstallRoot = null;
}
