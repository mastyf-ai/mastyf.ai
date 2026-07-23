/**
 * `mastyf-ai start` — Fleet Hub (default) or IDE-managed proxy + dashboard.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import chalk from 'chalk';
import { resolveMastyfAiInstallRoot } from '../utils/mastyf-ai-package-root.js';
import { pickMastyfAiConfig } from '../utils/pick-mastyf-ai-config.js';
import { applyStartEnv, isDashboardSpaBuilt, resolveStartPolicy } from '../utils/start-env.js';
import { discoverAllServers } from '../fleet/unified-server-registry.js';
import { runWrap, resolveClientConfigPath } from '../wrap/client-wrap.js';
import { isMastyfAiProxyCommand } from '../utils/windows-paths.js';

export interface StartOptions {
  config?: string;
  policy?: string;
  blockingMode?: string;
  buildDashboard?: boolean;
  installRoot?: string;
  searchRoots?: string[];
  ideManaged?: boolean;
  noApplyIde?: boolean;
  client?: import('../wrap/client-wrap.js').WrapClient;
}

function isMonorepoRoot(root: string): boolean {
  return (
    existsSync(join(root, 'pnpm-workspace.yaml'))
    && existsSync(join(root, 'package.json'))
  );
}

async function maybeBuildDashboard(installRoot: string, force: boolean): Promise<void> {
  if (!force && isDashboardSpaBuilt(installRoot)) return;
  const script = join(installRoot, 'scripts', 'build-dashboard-spa.sh');
  if (!existsSync(script)) {
    if (!isDashboardSpaBuilt(installRoot)) {
      console.error(
        chalk.yellow(
          '  Dashboard SPA not built; npm package should include deploy/dashboard-spa/out/. ' +
            'Reinstall @mastyf_ai/server or run from a git clone with `mastyf-ai setup`.',
        ),
      );
    }
    return;
  }
  console.log(chalk.dim('[start] Building dashboard SPA…'));
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn('sh', [script], { cwd: installRoot, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolvePromise() : reject(new Error(`dashboard build exited ${code}`))));
  });
}

async function needsAutoWrap(): Promise<boolean> {
  const clientPath = resolveClientConfigPath('auto');
  if (!clientPath) return false;
  try {
    const { ConfigParser } = await import('../config-parser.js');
    const servers = ConfigParser.parse(clientPath);
    return servers.some((s) => {
      if (!s.command) return false;
      if (isMastyfAiProxyCommand(s.command)) return false;
      return !(s.args ?? []).includes('proxy');
    });
  } catch {
    return false;
  }
}

async function runIdeManagedStart(opts: StartOptions, installRoot: string): Promise<void> {
  const workspaceRoot = resolve(process.cwd());
  const policy = opts.policy ?? resolveStartPolicy(installRoot);
  const policyAbs = existsSync(policy) ? policy : join(installRoot, policy);

  if (await needsAutoWrap()) {
    console.log(chalk.dim('[start] Auto-wrapping unprotected IDE MCP servers…'));
    try {
      runWrap({
        client: opts.client ?? 'auto',
        projectRoot: installRoot,
        workspaceRoot,
        policyPath: policyAbs,
        apply: !opts.noApplyIde,
      });
    } catch (err: unknown) {
      console.error(chalk.yellow(`  Auto-wrap skipped: ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  const searchRoots = opts.searchRoots ?? [process.cwd(), installRoot];
  const config = pickMastyfAiConfig({ configPath: opts.config, searchRoots });
  if (!config) {
    const discovered = discoverAllServers({ workspaceRoot });
    if (discovered.length > 0) {
      console.error(chalk.yellow('\n  Multiple servers detected — use Fleet Hub (default) instead of --ide-managed.\n'));
    }
    console.error(chalk.red('\nNo single-server Mastyf AI MCP config found.\n'));
    console.error(chalk.dim('  1. mastyf-ai start              (Fleet Hub — recommended)'));
    console.error(chalk.dim('  2. mastyf-ai onboard --apply'));
    console.error(chalk.dim('  3. mastyf-ai start --ide-managed --config mastyf-ai-configs/filesystem.json\n'));
    process.exit(1);
  }

  const blockingMode = opts.blockingMode || process.env.MASTYF_AI_BLOCKING_MODE || 'block';
  const port = process.env.DASHBOARD_PORT || '4000';

  console.log(chalk.bold('\nMCP Mastyf AI — IDE-managed proxy + dashboard\n'));
  console.log(chalk.dim(`  Dashboard: http://localhost:${port}/`));
  console.log(chalk.dim(`  Config: ${config}`));
  console.log(chalk.dim(`  Policy: ${policyAbs}\n`));

  const distCli = join(installRoot, 'dist', 'cli.js');
  const args = [
    distCli,
    'proxy',
    '--config',
    config,
    '--policy',
    policyAbs,
    '--blocking-mode',
    blockingMode,
  ];

  const child = spawn(process.execPath, args, {
    cwd: installRoot,
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

export async function runStart(opts: StartOptions = {}): Promise<void> {
  const installRoot = resolve(opts.installRoot ?? resolveMastyfAiInstallRoot());
  const distCli = join(installRoot, 'dist', 'cli.js');
  if (!existsSync(distCli)) {
    console.error(chalk.red(`MCP Mastyf AI not built: missing ${distCli}`));
    console.error(chalk.dim('  Git clone: run `mastyf-ai setup` or `pnpm install && pnpm build`'));
    console.error(chalk.dim('  npm: reinstall `npm install -g @mastyf_ai/server@latest`'));
    process.exit(1);
  }

  applyStartEnv();

  const autoBuild =
    opts.buildDashboard
    || process.env.MASTYF_AI_AUTO_BUILD_DASHBOARD === 'true'
    || (isMonorepoRoot(installRoot) && !isDashboardSpaBuilt(installRoot));
  if (autoBuild) {
    try {
      await maybeBuildDashboard(installRoot, !!opts.buildDashboard);
    } catch (err: unknown) {
      console.error(chalk.red(`Dashboard build failed: ${(err as Error).message}`));
      process.exit(1);
    }
  } else if (!isDashboardSpaBuilt(installRoot)) {
    console.log(chalk.yellow('  Note: full dashboard UI needs deploy/dashboard-spa/out/ (legacy HTML fallback may be used).'));
  }

  const ideManaged = opts.ideManaged
    || process.env.MASTYF_AI_IDE_MANAGED === 'true';

  if (ideManaged) {
    await runIdeManagedStart(opts, installRoot);
    return;
  }

  const policy = opts.policy ?? resolveStartPolicy(installRoot);
  const policyAbs = existsSync(policy) ? policy : join(installRoot, policy);

  console.log(chalk.bold('\nMCP Mastyf AI — Fleet Hub\n'));

  const { runFleetSupervisor } = await import('../fleet/fleet-supervisor.js');
  await runFleetSupervisor({
    installRoot,
    workspaceRoot: process.cwd(),
    policyPath: policyAbs,
    blockingMode: opts.blockingMode,
    client: opts.client ?? 'auto',
    applyIde: !opts.noApplyIde,
  });
}
