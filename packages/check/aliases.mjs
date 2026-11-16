// Modules the free check path imports but must not run: swapped for do-nothing stubs in the build and the tests.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const src = resolve(here, '../../src');
const stub = (name) => resolve(here, 'stubs', name);
/** Forward slashes and lower case on Windows, so keys and resolved ids compare equal. */
const norm = (p) => { const s = p.split(String.fromCharCode(92)).join('/'); return process.platform === 'win32' ? s.toLowerCase() : s; };

export const STUBBED = {
  [norm(resolve(src, 'utils/agentic-container'))]: stub('agentic-container.ts'),
  [norm(resolve(src, 'agentic/proxy-integration'))]: stub('agentic-proxy-integration.ts'),
  [norm(resolve(src, 'agentic/zero-trust/tier-adjuster'))]: stub('tier-adjuster.ts'),
  [norm(resolve(src, 'services/unified-spend-pool'))]: stub('spend-pool.ts'),
  [norm(resolve(src, 'extensions/index'))]: stub('extensions.ts'),
  [norm(resolve(src, 'license/license-client'))]: stub('license-client.ts'),
};

/** Resolves an import (with or without .js/.ts) to its stub, or null. */
export function stubFor(absolutePath) {
  const bare = norm(absolutePath.split('?')[0]).replace(/\.(js|ts)$/, '');
  return STUBBED[bare] ?? null;
}
