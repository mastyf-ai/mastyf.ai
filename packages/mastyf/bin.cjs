#!/usr/bin/env node
'use strict';
/** `npx mastyf <command>`: the short name for the @mastyf_ai/server CLI. */
const { spawnSync } = require('node:child_process');

function run(argv, deps) {
  const res = deps.spawnSync(deps.execPath, [deps.cliPath, ...argv], { stdio: 'inherit' });
  return res.status === null ? 1 : res.status;
}

if (require.main === module) {
  const cliPath = require.resolve('@mastyf_ai/server/cli');
  process.exit(run(process.argv.slice(2), { cliPath, execPath: process.execPath, spawnSync }));
}

module.exports = { run };
