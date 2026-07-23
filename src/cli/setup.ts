/**
 * `mastyf-ai setup` — one-shot dev install (git clone).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import chalk from 'chalk';
import { resolveMastyfAiInstallRoot } from '../utils/mastyf-ai-package-root.js';

export interface SetupOptions {
  projectRoot?: string;
  skipDashboard?: boolean;
}

function runCmd(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    console.log(chalk.dim(`\n> ${cmd} ${args.join(' ')}\n`));
    const child = spawn(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

export async function runSetup(opts: SetupOptions = {}): Promise<void> {
  const root = resolve(opts.projectRoot ?? resolveMastyfAiInstallRoot());
  const workspace = join(root, 'pnpm-workspace.yaml');
  const pkg = join(root, 'package.json');

  if (!existsSync(workspace) || !existsSync(pkg)) {
    console.error(chalk.red('mastyf-ai setup is for git clones of the monorepo.'));
    console.error(chalk.dim('  npm users: npm install -g @mastyf_ai/server && mastyf-ai onboard --apply && mastyf-ai start'));
    process.exit(1);
  }

  console.log(chalk.bold('\nMCP Mastyf AI — developer setup\n'));
  console.log(chalk.dim(`  Project root: ${root}\n`));

  try {
    await runCmd('pnpm', ['install'], root);
    await runCmd('pnpm', ['run', 'build'], root);
    if (!opts.skipDashboard) {
      const dashScript = join(root, 'scripts', 'build-dashboard-spa.sh');
      if (existsSync(dashScript)) {
        await runCmd('sh', [dashScript], root);
      } else {
        await runCmd('pnpm', ['run', 'dashboard:build'], root);
      }
    }
  } catch (err: unknown) {
    console.error(chalk.red(`\nSetup failed: ${(err as Error).message}`));
    console.error(chalk.dim('  If better-sqlite3 fails, run: pnpm approve-builds'));
    process.exit(1);
  }

  console.log(chalk.green('\nSetup complete.\n'));
  console.log(chalk.cyan('  Next: mastyf-ai start'));
  console.log(chalk.dim('  Or:   pnpm dashboard:proxy\n'));
}
