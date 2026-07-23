import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vitest/Vite resolve aliases for workspace packages.
 * Point at TypeScript sources so root tests work before `pnpm run build`.
 * More-specific subpaths must appear before package roots.
 */
export const workspacePackageAliases = [
  {
    find: '@mastyf_ai/mcp-server/http-proxy-utils',
    replacement: path.resolve(root, 'packages/server/src/http-proxy-utils.ts'),
  },
  {
    find: '@mastyf_ai/mcp-server/http-proxy',
    replacement: path.resolve(root, 'packages/server/src/http-proxy.ts'),
  },
  {
    find: '@mastyf_ai/mcp-server',
    replacement: path.resolve(root, 'packages/server/src/index.ts'),
  },
  {
    find: '@mastyf_ai/core',
    replacement: path.resolve(root, 'packages/core/src/index.ts'),
  },
  {
    find: '@mastyf_ai/plugin-sdk',
    replacement: path.resolve(root, 'packages/plugin-sdk/dist/index.js'),
  },
];
