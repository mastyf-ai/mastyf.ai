import { execSync } from 'node:child_process';
import { existsSync, accessSync, constants, readdirSync, readFileSync } from 'fs';
import { resolve, dirname, join, basename } from 'path';
import { load } from 'js-yaml';
import chalk from 'chalk';
import { parsePolicyConfig, formatPolicyValidationErrors } from '../policy/policy-schema.js';
import { validateSignedPolicyYaml, type PolicySignatureEnvelope } from '../policy/policy-signature.js';
import { resolveMastyfAiDbPath } from './mastyf-ai-db-path.js';
import { isAiLearningEnabled, isAiAutoApplyEnabled } from './ai-enabled.js';
import { isFieldEncryptionEnabled } from './field-encryption.js';
import { resolveMastyfAiInstallRoot } from './mastyf-ai-package-root.js';
import { isDashboardSpaBuilt } from './start-env.js';
import { readOnboardArtifact } from '../cli/onboard.js';
import { pickMastyfAiConfig } from './pick-mastyf-ai-config.js';

export interface DoctorOptions {
  policyPath?: string;
  configPath?: string;
  validatePolicy?: boolean;
}

function validatePolicyAtPath(resolvedPolicy: string): number {
  let issues = 0;
  try {
    const yaml = readFileSync(resolvedPolicy, 'utf-8');
    parsePolicyConfig(load(yaml));
    console.log(chalk.green('  Policy schema: valid'));
  } catch (err: unknown) {
    const details = formatPolicyValidationErrors(err);
    console.log(chalk.red('  Policy schema: invalid'));
    for (const d of details) {
      console.log(chalk.dim(`    ${d.path}: ${d.message}`));
    }
    issues++;
  }

  const sigPath = join(dirname(resolvedPolicy), `.${basename(resolvedPolicy)}.sig.json`);
  if (existsSync(sigPath)) {
    try {
      const yaml = readFileSync(resolvedPolicy, 'utf-8');
      const envelope = JSON.parse(readFileSync(sigPath, 'utf-8')) as PolicySignatureEnvelope;
      const result = validateSignedPolicyYaml(yaml, envelope);
      if (result.ok) {
        console.log(chalk.green('  Policy signature: valid'));
      } else {
        console.log(chalk.red(`  Policy signature: ${result.reason}`));
        issues++;
      }
    } catch (err: unknown) {
      console.log(chalk.red(`  Policy signature: ${err instanceof Error ? err.message : String(err)}`));
      issues++;
    }
  }

  return issues;
}

function checkPortInUse(port: number): boolean {
  try {
    if (process.platform === 'win32') return false;
    const out = execSync(`lsof -ti :${port} 2>/dev/null || true`, { encoding: 'utf8' }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

export function runDoctor(opts: DoctorOptions = {}): number {
  let issues = 0;
  const installRoot = resolveMastyfAiInstallRoot();
  const distCli = join(installRoot, 'dist', 'cli.js');
  const dbPath = resolveMastyfAiDbPath();
  const policyPath = opts.policyPath
    || process.env.MASTYF_AI_POLICY_PATH
    || process.env.MASTYF_AI_POLICY_PATH
    || 'default-policy.yaml';

  console.log(chalk.bold('\nMCP Mastyf AI Doctor\n'));

  if (existsSync(distCli)) {
    console.log(chalk.green(`  Install root: ${installRoot}`));
    console.log(chalk.green('  dist/cli.js: OK'));
  } else {
    console.log(chalk.red(`  dist/cli.js missing under ${installRoot}`));
    console.log(chalk.dim('    Fix: mastyf-ai setup   (git clone) or npm install -g @mastyf_ai/server'));
    issues++;
  }

  if (isDashboardSpaBuilt(installRoot)) {
    console.log(chalk.green('  Dashboard SPA: built (deploy/dashboard-spa/out/)'));
  } else {
    console.log(chalk.yellow('  Dashboard SPA: not built (legacy HTML fallback only)'));
    console.log(chalk.dim('    Fix: mastyf-ai setup   or   mastyf-ai start --build-dashboard'));
    issues++;
  }

  const dbDir = dbPath === ':memory:' ? null : dirname(dbPath);
  if (dbPath === ':memory:') {
    console.log(chalk.yellow('  DB: in-memory (tests only)'));
  } else {
    try {
      if (dbDir && !existsSync(dbDir)) {
        console.log(chalk.yellow(`  DB dir missing (will be created): ${dbDir}`));
      }
      accessSync(dbDir || dbPath, constants.W_OK);
      console.log(chalk.green(`  DB path writable: ${dbPath}`));
    } catch {
      console.log(chalk.red(`  DB path not writable: ${dbPath}`));
      console.log(chalk.dim(`    Fix: rm -f "${dbPath}-wal" "${dbPath}-shm" and retry`));
      issues++;
    }
  }

  const resolvedPolicy = existsSync(policyPath)
    ? resolve(policyPath)
    : resolve(installRoot, policyPath);
  if (existsSync(resolvedPolicy)) {
    console.log(chalk.green(`  Policy file: ${resolvedPolicy}`));
    if (opts.validatePolicy !== false) {
      issues += validatePolicyAtPath(resolvedPolicy);
    }
  } else {
    console.log(chalk.red(`  Policy file missing: ${resolvedPolicy}`));
    issues++;
  }

  const onboard = readOnboardArtifact();
  if (onboard) {
    console.log(chalk.green(`  Onboard: ${onboard.client} (${onboard.onboardedAt})`));
    if (onboard.configsDir && existsSync(onboard.configsDir)) {
      const n = readdirSync(onboard.configsDir).filter((f) => f.endsWith('.json')).length;
      console.log(chalk.dim(`    mastyf-ai-configs: ${n} file(s) in ${onboard.configsDir}`));
    }
  } else {
    console.log(chalk.yellow('  Onboard: not run yet'));
    console.log(chalk.dim('    Fix: mastyf-ai onboard --apply'));
  }

  const picked = pickMastyfAiConfig({
    configPath: opts.configPath,
    searchRoots: [process.cwd(), installRoot],
  });
  if (opts.configPath) {
    const cfg = resolve(process.cwd(), opts.configPath);
    if (existsSync(cfg)) {
      console.log(chalk.green(`  MCP config: ${cfg}`));
    } else {
      console.log(chalk.red(`  MCP config missing: ${cfg}`));
      issues++;
    }
  } else if (picked) {
    console.log(chalk.green(`  MCP config (auto): ${picked}`));
  } else {
    console.log(chalk.yellow('  MCP config: none (single stdio server)'));
    console.log(chalk.dim('    Fix: mastyf-ai onboard --apply'));
    issues++;
  }

  const port = parseInt(process.env.DASHBOARD_PORT || '4000', 10);
  if (checkPortInUse(port)) {
    console.log(chalk.yellow(`  Port ${port}: in use (proxy may already be running)`));
  } else {
    console.log(chalk.dim(`  Port ${port}: available`));
  }

  const dashboard = process.env.DASHBOARD_ENABLED === 'true';
  const ws = process.env.MASTYF_AI_WS_ENABLED !== 'false';
  console.log(chalk.dim(`  Dashboard API: ${dashboard ? 'enabled' : 'disabled'} (set by mastyf-ai start)`));
  console.log(chalk.dim(`  Live WebSocket: ${ws ? 'enabled' : 'disabled'}`));

  if (process.env.MASTYF_AI_ENTERPRISE_MODE === 'true' && !isFieldEncryptionEnabled()) {
    console.log(
      chalk.yellow(
        '  Enterprise mode: MASTYF_AI_DB_ENCRYPTION_KEY unset — audit block_reason/args stored in plaintext',
      ),
    );
    issues++;
  }

  if (isAiLearningEnabled()) {
    console.log(chalk.green('  AI learning: enabled (default)'));
    console.log(chalk.dim(`    Auto-apply rules: ${isAiAutoApplyEnabled() ? 'ON' : 'off'}`));
  } else {
    console.log(chalk.yellow('  AI learning: disabled (MASTYF_AI_AI_ENABLED=false)'));
  }

  if (picked || opts.configPath) {
    const cfgPath = opts.configPath ? resolve(process.cwd(), opts.configPath) : picked!;
    try {
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8')) as { mcpServers?: Record<string, { url?: string }> };
      const strictTls = process.env.MASTYF_AI_STRICT_MODE === 'true';
      for (const [name, srv] of Object.entries(cfg.mcpServers || {})) {
        const url = srv?.url;
        if (url?.startsWith('http://')) {
          const line = `  MCP upstream ${name}: plaintext http:// (use https://)`;
          if (strictTls) {
            console.log(chalk.red(line));
            issues++;
          } else {
            console.log(chalk.yellow(line));
          }
        }
      }
    } catch {
      /* config parse handled above */
    }
  }

  console.log(chalk.cyan('\n  Quick start:'));
  console.log(chalk.dim('    npm install -g @mastyf_ai/server@latest'));
  console.log(chalk.dim('    mastyf-ai onboard --apply'));
  console.log(chalk.dim('    mastyf-ai start\n'));

  if (issues > 0) {
    console.log(chalk.yellow(`  ${issues} issue(s) — fix items above, then: mastyf-ai start\n`));
  }

  return issues > 0 ? 1 : 0;
}
