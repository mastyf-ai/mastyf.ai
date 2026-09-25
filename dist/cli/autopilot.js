/**
 * Mastyf AI Autopilot CLI — init, start, status.
 */
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import chalk from 'chalk';
import { defaultAutopilotConfig, readAutopilotConfig, writeAutopilotConfig, } from '../utils/autopilot-config.js';
import { forceAutopilotEnv } from '../utils/autopilot-profile.js';
import { buildAutopilotStatus } from '../utils/autopilot-status.js';
import { runOnboard } from './onboard.js';
export async function runAutopilotInit(opts) {
    const projectRoot = resolve(opts.projectRoot);
    const policyPath = 'default-policy.yaml';
    if (!existsSync(join(projectRoot, policyPath))) {
        console.log(chalk.yellow(`  Warning: ${policyPath} not found in project root — use --policy if elsewhere.`));
    }
    console.log(chalk.bold('\nMastyf AI Autopilot — init\n'));
    runOnboard({
        client: opts.client,
        configPath: opts.configPath,
        policyPath,
        projectRoot,
        apply: opts.apply,
        skipNames: ['mastyf-ai', 'mastyf-ai'],
        startProxy: true,
    });
    const cfg = defaultAutopilotConfig(opts.tenantId);
    cfg.policyPath = policyPath;
    cfg.blockingMode = 'block';
    writeAutopilotConfig(cfg);
    try {
        const { ensureThreatLabLlmReady } = await import('../ai/threat-lab.js');
        const ready = await ensureThreatLabLlmReady();
        if (ready.ok) {
            console.log(chalk.green('  Ollama / LLM: ready'));
        }
        else {
            console.log(chalk.yellow(`  Ollama / LLM: ${ready.reason || 'not ready'} (Threat Lab needs local Ollama)`));
        }
    }
    catch {
        console.log(chalk.yellow('  Ollama / LLM: check skipped'));
    }
    try {
        const { getLicenseClient } = await import('../license/license-client.js');
        const lc = getLicenseClient();
        await lc.start();
        if (lc.hasFeature('dashboard')) {
            console.log(chalk.green('  Dashboard API: available'));
        }
        else {
            console.log(chalk.yellow('  Dashboard API: set DASHBOARD_ENABLED=true to enable'));
        }
    }
    catch {
        console.log(chalk.dim('  License check skipped'));
    }
    console.log(chalk.green(`\nAutopilot config written. Next: mastyf-ai autopilot start\n`));
}
export async function runAutopilotStatus(historyDbAttached = false) {
    const status = await buildAutopilotStatus(undefined, historyDbAttached);
    console.log(chalk.bold('\nMastyf AI Autopilot status\n'));
    console.log(`  Enabled: ${status.autopilotEnabled}`);
    console.log(`  History DB: ${status.protection.historyDbAttached ? 'attached' : 'none'}`);
    console.log(`  Pending suggestions: ${status.learning.pendingSuggestions}`);
    console.log(`  Threat research queue: ${status.learning.threatResearchQueue.queued}`);
    console.log(`  Scheduler: ${status.scheduler.running ? 'running' : 'stopped'}`);
    if (status.lastDigest?.generatedAt) {
        console.log(`  Last digest: ${status.lastDigest.generatedAt}`);
    }
    console.log(`  LLM: ${status.llm.ok ? 'ok' : status.llm.reason || 'unavailable'}`);
    for (const m of status.messages) {
        console.log(chalk.dim(`  · ${m}`));
    }
    console.log('');
}
export function runAutopilotStart(opts) {
    const projectRoot = resolve(opts.projectRoot);
    const cfg = readAutopilotConfig();
    if (!cfg) {
        console.error(chalk.red('Run `mastyf-ai autopilot init` first.'));
        process.exit(1);
    }
    forceAutopilotEnv(cfg);
    const distCli = join(projectRoot, 'dist', 'cli.js');
    if (!existsSync(distCli)) {
        console.error(chalk.red('Build required: pnpm build'));
        process.exit(1);
    }
    const defaultConfigPath = join(projectRoot, 'mastyf-ai-configs', 'filesystem.json');
    const config = opts.config || (existsSync(defaultConfigPath) ? defaultConfigPath : undefined);
    const args = ['proxy', '--policy', opts.policy || cfg.policyPath, '--blocking-mode', cfg.blockingMode];
    if (config)
        args.push('--config', config);
    console.log(chalk.bold('\nStarting Mastyf AI Autopilot proxy + dashboard…\n'));
    console.log(chalk.dim(`  MASTYF_AI_AUTOPILOT=true DASHBOARD_ENABLED=true`));
    console.log(chalk.dim(`  node dist/cli.js ${args.join(' ')}\n`));
    const child = spawn(process.execPath, [distCli, ...args], {
        cwd: projectRoot,
        stdio: 'inherit',
        env: { ...process.env, MASTYF_AI_AUTOPILOT: 'true' },
    });
    child.on('exit', (code) => process.exit(code ?? 0));
}
//# sourceMappingURL=autopilot.js.map