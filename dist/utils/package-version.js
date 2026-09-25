import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const __pkgDir = dirname(fileURLToPath(import.meta.url));
/** Package version from package.json (not stale fallbacks). */
export function readPackageVersion() {
    try {
        const pkg = JSON.parse(readFileSync(join(__pkgDir, '..', '..', 'package.json'), 'utf-8'));
        return pkg.version || process.env.npm_package_version || '0.0.0';
    }
    catch {
        return process.env.npm_package_version || '0.0.0';
    }
}
//# sourceMappingURL=package-version.js.map