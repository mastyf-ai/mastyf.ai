/**
 * Locate bundled Gateway / BFF / UI / policy when packaged.
 * Unpackaged dogfood still uses the repo checkout.
 */
'use strict';

const { existsSync } = require('node:fs');
const { join, resolve } = require('node:path');

/**
 * @param {{
 *   packaged: boolean,
 *   resourcesPath?: string,
 *   repoRoot: string,
 *   execDir: string,
 *   env?: NodeJS.ProcessEnv,
 * }} opts
 */
function resolveStackLayout(opts) {
  const env = opts.env || {};
  const packaged = Boolean(opts.packaged);
  const repoRoot = resolve(opts.repoRoot);
  const resourcesPath = String(opts.resourcesPath || '').trim();
  const stagedOverride = String(env.MASTYF_SHIELD_STACK_ROOT || '').trim();

  const stackRoot = stagedOverride
    ? resolve(stagedOverride)
    : packaged && resourcesPath
      ? join(resourcesPath, 'stack')
      : join(repoRoot);

  const gatewaySrc = packaged
    ? join(stackRoot, 'gateway')
    : join(repoRoot, 'mastyf_gateway');

  const pythonCandidates = packaged
    ? [
        env.MASTYF_PYTHON,
        join(stackRoot, 'python-venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
        join(stackRoot, 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3'),
      ]
    : [
        env.MASTYF_PYTHON,
        join(repoRoot, '.venv-soup', 'bin', 'python'),
        'python3',
      ];

  const python = pythonCandidates.filter(Boolean).find((p) => p === 'python3' || existsSync(p)) || 'python3';

  const nodeBin = packaged
    ? [
        env.MASTYF_NODE,
        join(stackRoot, 'node', process.platform === 'win32' ? 'node.exe' : 'bin/node'),
      ]
        .filter(Boolean)
        .find((p) => existsSync(p))
    : null;

  const bffRoot = packaged ? join(stackRoot, 'bff') : repoRoot;
  const bffCli = join(bffRoot, 'dist', 'cli.js');
  const policy = packaged
    ? join(stackRoot, 'policy', 'default-policy.yaml')
    : join(repoRoot, 'default-policy.yaml');
  const mcpConfig = packaged
    ? join(stackRoot, 'configs', 'filesystem.json')
    : join(repoRoot, 'mastyf-ai-configs', 'filesystem.json');
  const deployRoot = packaged ? join(stackRoot, 'deploy') : join(repoRoot, 'deploy');
  const spaIndex = join(deployRoot, 'dashboard-spa', 'out', 'index.html');
  const licensePublicKey = packaged
    ? join(stackRoot, 'license-public.pem')
    : join(opts.execDir, 'dev-license-public.pem');

  return {
    packaged,
    stackRoot,
    repoRoot,
    gatewaySrc,
    python,
    nodeBin,
    bffRoot,
    bffCli,
    policy,
    mcpConfig,
    deployRoot,
    spaIndex,
    licensePublicKey,
    hasGatewaySrc: existsSync(join(gatewaySrc, 'mastyf_gateway')) || existsSync(join(gatewaySrc, 'mastyf_gateway', 'cli.py')),
    hasBffCli: existsSync(bffCli),
    hasSpa: existsSync(spaIndex),
    hasPolicy: existsSync(policy),
  };
}

/**
 * Packaged app cannot boot from a repo path that does not exist on the customer machine.
 * @param {ReturnType<typeof resolveStackLayout>} layout
 */
function evaluatePackagedStack(layout) {
  if (!layout.packaged) {
    return { ok: true, reason: 'unpackaged-dev' };
  }
  const missing = [];
  if (!layout.hasGatewaySrc) missing.push('gateway');
  if (!layout.hasBffCli) missing.push('bff');
  if (!layout.hasSpa) missing.push('ui');
  if (!layout.hasPolicy) missing.push('policy');
  if (missing.length) {
    return {
      ok: false,
      reason: 'stack-not-bundled',
      missing,
      detail: `This installer is missing bundled extraResources (${missing.join(', ')}). It is not a customer product. Rebuild with scripts/stage-shield-bundle.sh.`,
    };
  }
  return { ok: true, reason: 'bundled' };
}

module.exports = { resolveStackLayout, evaluatePackagedStack };
