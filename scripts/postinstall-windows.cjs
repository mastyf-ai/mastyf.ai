#!/usr/bin/env node
/**
 * On Windows, verify better-sqlite3 loads and print actionable guidance if not.
 */
if (process.platform !== 'win32') {
  process.exit(0);
}

const hints = [
  'MCP Guardian on Windows: better-sqlite3 failed to load.',
  '',
  'Official npm installs ship prebuilt binaries for Node 20 win32-x64.',
  'If install used --ignore-scripts or a custom Node build, native compile may be required:',
  '  - Install Visual Studio Build Tools (Desktop development with C++)',
  '  - Or use WSL2 for full IDE proxy support',
  '',
  'See docs/WINDOWS.md for details.',
].join('\n');

try {
  require('better-sqlite3');
} catch (err) {
  console.warn(hints);
  console.warn(`Load error: ${err instanceof Error ? err.message : err}`);
}
