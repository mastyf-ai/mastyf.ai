import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import chalk from 'chalk';
import { runWrap, resolveClientConfigPath } from '../wrap/client-wrap.js';
import { resolveMastyfAiDbPath } from '../utils/mastyf-ai-db-path.js';
import { resolveMastyfAiInstallRoot } from '../utils/mastyf-ai-package-root.js';
const ONBOARD_DIR = join(homedir(), '.mastyf-ai');
const ONBOARD_PATH = join(ONBOARD_DIR, 'onboard.json');
export function readOnboardArtifact() {
    if (!existsSync(ONBOARD_PATH))
        return null;
    try {
        return JSON.parse(readFileSync(ONBOARD_PATH, 'utf-8'));
    }
    catch {
        return null;
    }
}
export function writeOnboardArtifact(data) {
    mkdirSync(ONBOARD_DIR, { recursive: true });
    writeFileSync(ONBOARD_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}
export function runOnboard(opts) {
    const installRoot = resolve(opts.projectRoot ?? resolveMastyfAiInstallRoot());
    const workspaceRoot = resolve(opts.workspaceRoot ?? process.cwd());
    const distCli = join(installRoot, 'dist', 'cli.js');
    if (!existsSync(distCli)) {
        throw new Error(`MCP Mastyf AI install incomplete: dist/cli.js missing under ${installRoot}. ` +
            `Reinstall with: npm install -g @mastyf_ai/server@latest`);
    }
    const clientPath = resolveClientConfigPath(opts.client, opts.configPath);
    if (!clientPath) {
        throw new Error(`No MCP config found for client "${opts.client}". Use --config <path> or install Cursor/Cline first.`);
    }
    console.log(chalk.bold('\nMCP Mastyf AI — Solo developer onboarding\n'));
    console.log(chalk.dim('Step 1/4 — Verify build'));
    console.log(chalk.green(`  dist/cli.js OK`));
    console.log(chalk.dim('\nStep 2/4 — Detect IDE MCP servers'));
    console.log(chalk.green(`  Client config: ${clientPath}`));
    console.log(chalk.dim('\nStep 3/4 — Wrap servers (policy-audit safe default)'));
    const wrap = runWrap({
        client: opts.client,
        configPath: opts.configPath,
        projectRoot: installRoot,
        workspaceRoot,
        policyPath: opts.policyPath,
        apply: opts.apply,
        skipNames: opts.skipNames,
    });
    if (wrap.wrapped.length === 0) {
        console.log(chalk.yellow('  No new servers wrapped (already wrapped or none with stdio command).'));
    }
    else {
        console.log(chalk.green(`  Wrapped: ${wrap.wrapped.join(', ')}`));
    }
    if (wrap.skipped.length) {
        console.log(chalk.dim(`  Skipped: ${wrap.skipped.join('; ')}`));
    }
    const artifact = {
        client: opts.client,
        clientConfigPath: wrap.clientConfigPath,
        policy: opts.policyPath,
        servers: wrap.wrapped,
        configsDir: wrap.configsDir,
        onboardedAt: new Date().toISOString(),
        applied: !!opts.apply && wrap.wrapped.length > 0,
    };
    writeOnboardArtifact(artifact);
    console.log(chalk.dim('\nStep 4/4 — Next steps'));
    if (!opts.apply && wrap.wrapped.length > 0) {
        console.log(chalk.yellow('  Re-run with --apply to patch your IDE MCP config.'));
    }
    else if (artifact.applied) {
        console.log(chalk.green('  Reload MCP servers in your IDE (restart Cursor or reconnect MCP).'));
    }
    console.log(chalk.cyan('\n  Observe traffic:'));
    console.log(chalk.dim('    mastyf-ai start'));
    console.log(chalk.dim('    Open http://localhost:4000 → Setup tab'));
    if (opts.startProxy && wrap.wrapped.length > 0) {
        console.log(chalk.cyan('\n  Start proxy + dashboard:'));
        console.log(chalk.dim('    mastyf-ai start'));
    }
    console.log(chalk.cyan('\n  Run security analysis:'));
    console.log(chalk.dim('    Dashboard → Agent flow → Run full security analysis'));
    console.log(chalk.dim('    Or: pnpm security-swarm:analyze'));
    console.log(chalk.dim(`\n  Onboard status saved: ${ONBOARD_PATH}`));
    console.log(chalk.dim(`  History DB: ${resolveMastyfAiDbPath()}`));
    return artifact;
}
export async function runOnboardAndMaybeStart(opts) {
    const artifact = runOnboard(opts);
    if (opts.start) {
        const { runStart } = await import('./start.js');
        await runStart({ installRoot: resolve(opts.projectRoot ?? resolveMastyfAiInstallRoot()) });
    }
    return artifact;
}
