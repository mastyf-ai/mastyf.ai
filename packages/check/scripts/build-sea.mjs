// Builds a single-file program for this platform (Node single executable application):
// dist/mastyf-check-<platform>-<arch>[.exe]. Run `node esbuild.mjs` first.
// Uses the Node that runs this script; CI runs it on each platform with Node 22.
import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(here, 'dist');
const plat = { win32: 'win', darwin: 'darwin', linux: 'linux' }[process.platform] ?? process.platform;
const exe = resolve(dist, `mastyf-check-${plat}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`);

// The main script of a single executable can't start with a #! line.
const bundle = readFileSync(resolve(dist, 'mastyf-check.cjs'), 'utf8').replace(/^#!.*\n/, '');
const main = resolve(dist, 'sea-main.cjs');
writeFileSync(main, bundle);
const blob = resolve(dist, 'sea-prep.blob');
writeFileSync(
  resolve(dist, 'sea-config.json'),
  JSON.stringify({ main, output: blob, disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false }),
);
execFileSync(process.execPath, ['--experimental-sea-config', resolve(dist, 'sea-config.json')], { stdio: 'inherit' });

rmSync(exe, { force: true });
copyFileSync(process.execPath, exe);
if (process.platform === 'darwin') execFileSync('codesign', ['--remove-signature', exe], { stdio: 'inherit' });

const args = [exe, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'];
if (process.platform === 'darwin') args.push('--macho-segment-name', 'NODE_SEA');
execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'postject@1.0.0-alpha.6', ...args], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', exe], { stdio: 'inherit' });

rmSync(main, { force: true });
rmSync(blob, { force: true });
rmSync(resolve(dist, 'sea-config.json'), { force: true });
console.log(`built ${exe}`);
