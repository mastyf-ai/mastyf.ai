// Starts a downloaded VS Code with this extension and a throwaway profile, against the live Shield.
const { runTests } = require('@vscode/test-electron');
const path = require('node:path');

const exe = process.env.SMOKE_VSCODE_EXE;

runTests({
  ...(exe ? { vscodeExecutablePath: exe } : {}),
  version: process.env.SMOKE_VSCODE_VERSION || 'stable',
  cachePath: 'E:/cache/vscode-test',
  timeout: 600000,
  extensionDevelopmentPath: path.resolve(__dirname, '..'),
  extensionTestsPath: path.resolve(__dirname, 'suite.cjs'),
  launchArgs: ['--user-data-dir', 'E:/cache/vscode-smoke-profile', '--disable-extensions', '--new-window'],
  extensionTestsEnv: { MASTYF_SHIELD_EXT_SMOKE: '1', SMOKE_OUT: process.env.SMOKE_OUT || 'E:/cache/vscode-smoke-result.json' },
}).catch((err) => {
  console.error('smoke run failed:', err && err.message);
  process.exit(1);
});
