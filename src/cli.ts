#!/usr/bin/env node
import path, { dirname, join } from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import { ConfigParser } from './config-parser.js';
import { HistoryDatabase } from './database/history-db.js';
import { ReportGenerator } from './reporter/report-generator.js';
import { FullReport, SecurityReport, McpServerConfig } from './types.js';
import { calculateOverallScore } from './utils/scoring.js';
import { ProxyManager } from './proxy/proxy-manager.js';
import { PolicyEngine } from './policy/policy-engine.js';
import { PolicyWatcher } from './policy/policy-watcher.js';
import { PolicyConfig } from './policy/policy-types.js';
import { OAuthValidator } from './auth/oauth.js';
import { AuthConfig } from './auth/auth-types.js';
import { shutdownMetrics, startMetricsServer } from './utils/metrics.js';
import { closeDashboardServer } from './utils/dashboard-server.js';
import { startDashboardServer, setDashboardDataSource } from './utils/dashboard-server.js';
import { DashboardAuth } from './auth/dashboard-auth.js';
import { initTracing } from './utils/tracing.js';
import { createContainer } from './container.js';
import { setAgenticContainer } from './utils/dashboard-server.js';
import { bootstrapCompliance, shutdownEnterprise, bootstrapControlPlane } from './utils/enterprise-bootstrap.js';
import { createDatabase } from './database/create-database.js';
import { bootstrapSecrets } from './utils/enterprise-bootstrap.js';
import { broadcastDashboardEvent } from './utils/dashboard-events.js';
import { triggerLearningCycleIfEnabled } from './ai/suggestion-engine.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolveMastyfAiInstallRoot } from './utils/mastyf-ai-package-root.js';

const __cliDir = dirname(fileURLToPath(import.meta.url));
function cliVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__cliDir, '..', 'package.json'), 'utf-8')) as { version?: string };
    return pkg.version || '0.0.0';
  } catch {
    return process.env.npm_package_version || '0.0.0';
  }
}
import { isAiLearningEnabled } from './utils/ai-enabled.js';
import { resolveCliTenantId, InvalidTenantIdError } from './tenant/resolve-tenant.js';
import { AsyncSerialQueue } from './utils/async-serial-queue.js';

// ── Typed option interfaces ──────────────────────────────────────────
interface ScanOptions {
  config?: string;
  all?: boolean;
  tenant?: string;
  thresholdScore?: number;
  failOnCritical?: boolean;
  failOnSecrets?: boolean;
}

interface AuditOptions {
  config?: string;
  all?: boolean;
  server?: string;
  tenant?: string;
  thresholdCost?: number;
}

interface HealthOptions {
  config?: string;
  all?: boolean;
  server?: string;
  tenant?: string;
  thresholdLatency?: number;
  failOnOverload?: boolean;
}

interface ReportOptions {
  config?: string;
  all?: boolean;
  tenant?: string;
  format?: 'json' | 'markdown' | 'text';
  output?: string;
  thresholdScore?: number;
}

interface ProxyOptions {
  config?: string;
  policy?: string;
  blockingMode?: string;
  dryRun?: boolean;
  gateway?: boolean;
  authIssuer?: string;
  authAudience?: string;
  authRequired?: boolean;
}

interface ControlPlaneOptions {
  port?: string;
  policy?: string;
}

// ── Shared helpers ────────────────────────────────────────────────────
function loadConfigs(options: { all?: boolean; config?: string }): {
  servers: McpServerConfig[];
  sourcePaths: string[];
} {
  if (options.all) {
    return ConfigParser.parseAll();
  }
  const paths = options.config ? [options.config] : ConfigParser.findConfigPaths();
  if (paths.length === 0) return { servers: [], sourcePaths: [] };
  return { servers: ConfigParser.parse(paths[0]), sourcePaths: [paths[0]] };
}

function cliTenantId(opts: { tenant?: string }): string {
  try {
    return resolveCliTenantId(opts);
  } catch (err) {
    if (err instanceof InvalidTenantIdError) {
      console.error(chalk.red(err.message));
      process.exit(1);
    }
    throw err;
  }
}

function checkScanStrict(reports: SecurityReport[]): void {
  if (process.env['MASTYF_AI_SCAN_STRICT'] !== 'true') return;
  const issues: string[] = [];
  for (const r of reports) {
    if (r.cveLookupStatus === 'degraded' || r.cveLookupStatus === 'unavailable') {
      issues.push(`${r.serverName}: CVE lookup ${r.cveLookupStatus}`);
    }
    if (!r.authStatus.hasAuthentication) {
      issues.push(`${r.serverName}: no authentication configured`);
    }
    if (r.typoSquatRisk.length > 0) {
      issues.push(`${r.serverName}: typo-squat risk (${r.typoSquatRisk.map((t) => t.suspiciousName).join(', ')})`);
    }
  }
  if (issues.length > 0) {
    console.error(chalk.red('MASTYF_AI_SCAN_STRICT failures:\n' + issues.map((i) => `  - ${i}`).join('\n')));
    process.exit(1);
  }
}

function checkAlertThresholds(reports: SecurityReport[], opts: ScanOptions | ReportOptions): void {
  checkScanStrict(reports);
  if ('failOnCritical' in opts && opts.failOnCritical && reports.some((r) => r.cves.some((c) => c.severity === 'CRITICAL'))) {
    console.error(chalk.red('\n⚠ Critical CVE(s) detected'));
    process.exit(1);
  }
  if ('failOnSecrets' in opts && opts.failOnSecrets && reports.some((r) => r.secretsFound.length > 0)) {
    console.error(chalk.red('\n⚠ Hardcoded secrets detected'));
    process.exit(1);
  }
  if (opts.thresholdScore !== undefined) {
    const below = reports.filter((r) => r.score < opts.thresholdScore!);
    if (below.length > 0) {
      console.error(chalk.red(`\n⚠ ${below.length} server(s) below score threshold ${opts.thresholdScore}: ${below.map((r) => `${r.serverName} (${r.score})`).join(', ')}`));
      process.exit(2);
    }
  }
}

// ── CLI commands ──────────────────────────────────────────────────────
const program = new Command();
program
  .name('mastyf-ai')
  .description('Security, cost, and health audit for MCP infrastructure')
  .version(cliVersion());

program
  .command('scan')
  .description('Run security scan on MCP servers')
  .option('-c, --config <path>', 'Path to an MCP config file')
  .option('-a, --all', 'Aggregate all discoverable config files')
  .option('--threshold-score <number>', 'Exit code 2 if any server score drops below threshold', parseInt)
  .option('--fail-on-critical', 'Exit code 1 if any critical CVE found')
  .option('--fail-on-secrets', 'Exit code 1 if any hardcoded secrets detected')
  .option('--tenant <id>', 'Tenant id for stored scan rows (default: MASTYF_AI_TENANT_ID)')
  .action(async (opts: ScanOptions) => {
    const { servers, sourcePaths } = loadConfigs(opts);
    if (servers.length === 0) { console.error(chalk.yellow('No servers found in config.')); process.exit(0); }

    if (opts.all && sourcePaths.length > 1) {
      console.error(chalk.dim(`Aggregated ${sourcePaths.length} configs: ${sourcePaths.join(', ')}`));
    } else {
      console.error(chalk.dim(`Using config: ${sourcePaths[0] || 'auto-detected'}`));
    }

    const tenantId = cliTenantId(opts);
    const container = await createContainer();
    const reports = await Promise.all(servers.map((s) => container.securityScanner.scanServer(s)));
    await Promise.all(reports.map((r) => container.db.addSecurityScan(r.serverName, r.score, r.cves.length, r, tenantId)));
    await triggerLearningCycleIfEnabled(container.db, servers, { cliCommand: true }); // no-op unless MASTYF_AI_AI_ON_CLI=true
    broadcastDashboardEvent({
      type: 'health-change',
      payload: { source: 'scan', servers: reports.length },
      timestamp: Date.now(),
    });
    container.db.close();

    console.log(new ReportGenerator().formatSecurityReports(reports));
    checkAlertThresholds(reports, opts);
  });

program
  .command('audit')
  .description('Audit token costs for MCP servers')
  .option('-c, --config <path>', 'Path to an MCP config file')
  .option('-a, --all', 'Aggregate all discoverable config files')
  .option('-s, --server <name>', 'Filter to a specific server')
  .option('--threshold-cost <number>', 'Exit code 2 if total cost exceeds threshold (USD)', parseFloat)
  .option('--tenant <id>', 'Tenant id for stored cost rows (default: MASTYF_AI_TENANT_ID)')
  .action(async (opts: AuditOptions) => {
    const { servers } = loadConfigs(opts);
    const filtered = opts.server ? servers.filter((s) => s.name === opts.server) : servers;
    if (filtered.length === 0) { console.error(chalk.yellow('No servers found.')); process.exit(0); }

    const tenantId = cliTenantId(opts);
    const container = await createContainer();
    const results = await Promise.all(filtered.map((s) => container.costAuditor.auditServer(s)));
    container.costAuditor.dispose();
    await Promise.all(results.map((r) => container.db.addCostRecord(r.serverName, r.tokensUsed, r.estimatedCostUSD, tenantId)));
    await triggerLearningCycleIfEnabled(container.db, filtered, { cliCommand: true }); // skipped unless MASTYF_AI_AI_ON_CLI=true
    container.db.close();

    console.log(new ReportGenerator().formatCostReports(results));

    if (opts.thresholdCost) {
      const total = results.reduce((s, r) => s + r.estimatedCostUSD, 0);
      if (total > opts.thresholdCost) {
        console.error(chalk.red(`\n⚠ Total cost $${total.toFixed(4)} exceeds threshold $${opts.thresholdCost.toFixed(4)}`));
        process.exit(2);
      }
    }
  });

program
  .command('health')
  .description('Check health of MCP servers')
  .option('-c, --config <path>', 'Path to an MCP config file')
  .option('-a, --all', 'Aggregate all discoverable config files')
  .option('-s, --server <name>', 'Filter to a specific server')
  .option('-f, --format <format>', 'Output format: text (default) or json', 'text')
  .option('--threshold-latency <ms>', 'Exit code 2 if any server exceeds latency threshold', parseInt)
  .option('--fail-on-overload', 'Exit code 1 if any server has tool overload')
  .option('--tenant <id>', 'Tenant id for stored health rows (default: MASTYF_AI_TENANT_ID)')
  .action(async (opts: HealthOptions) => {
    const { servers } = loadConfigs(opts);
    const filtered = opts.server ? servers.filter((s) => s.name === opts.server) : servers;
    if (filtered.length === 0) { console.error(chalk.yellow('No servers found.')); process.exit(0); }

    const tenantId = cliTenantId(opts);
    const container = await createContainer();
    const results = await Promise.all(filtered.map((s) => container.healthMonitor.checkServer(s, tenantId)));
    await Promise.all(results.map((r) => container.db.addHealthCheck(r.serverName, r.latencyMs, r.successRate > 0.5, r.toolCount, tenantId)));
    await triggerLearningCycleIfEnabled(container.db, filtered, { cliCommand: true }); // skipped unless MASTYF_AI_AI_ON_CLI=true
    container.db.close();

    console.log(new ReportGenerator().formatHealthReports(results));

    if (opts.failOnOverload && results.some((r) => r.overloadWarning)) {
      console.error(chalk.red('\n⚠ One or more servers have tool overload'));
      process.exit(1);
    }
    if (opts.thresholdLatency !== undefined) {
      const slow = results.filter((r) => r.latencyMs > opts.thresholdLatency!);
      if (slow.length > 0) {
        console.error(chalk.red(`\n⚠ ${slow.length} server(s) exceed ${opts.thresholdLatency}ms latency: ${slow.map((r) => r.serverName).join(', ')}`));
        process.exit(2);
      }
    }
  });

program
  .command('report')
  .description('Generate a full MCP Mastyf AI report')
  .option('-c, --config <path>', 'Path to an MCP config file')
  .option('-a, --all', 'Aggregate all discoverable config files')
  .option('-f, --format <format>', 'Output format: text (default), markdown, or json', 'text')
  .option('--output <path>', 'Save report to a file instead of stdout')
  .option('--threshold-score <number>', 'Exit code 2 if overall score drops below threshold', parseInt)
  .option('--tenant <id>', 'Tenant id for stored report rows (default: MASTYF_AI_TENANT_ID)')
  .action(async (opts: ReportOptions) => {
    const { servers, sourcePaths } = loadConfigs(opts);
    if (servers.length === 0) { console.error(chalk.yellow('No servers found in config.')); process.exit(0); }

    if (opts.all && sourcePaths.length > 1) {
      console.error(chalk.dim(`Aggregated ${sourcePaths.length} configs: ${sourcePaths.join(', ')}`));
    } else {
      console.error(chalk.dim(`Using config: ${sourcePaths[0] || 'auto-detected'}`));
    }

    const tenantId = cliTenantId(opts);
    const container = await createContainer();
    const [security, costs, health] = await Promise.all([
      Promise.all(servers.map((s) => container.securityScanner.scanServer(s))),
      Promise.all(servers.map((s) => container.costAuditor.auditServer(s))),
      Promise.all(servers.map((s) => container.healthMonitor.checkServer(s, tenantId))),
    ]);
    container.costAuditor.dispose();
    await Promise.all([
      ...security.map((r) => container.db.addSecurityScan(r.serverName, r.score, r.cves.length, r, tenantId)),
      ...costs.map((r) => container.db.addCostRecord(r.serverName, r.tokensUsed, r.estimatedCostUSD, tenantId)),
      ...health.map((r) => container.db.addHealthCheck(r.serverName, r.latencyMs, r.successRate > 0.5, r.toolCount, tenantId)),
    ]);
    await triggerLearningCycleIfEnabled(container.db, servers, { cliCommand: true }); // no-op unless MASTYF_AI_AI_ON_CLI=true
    broadcastDashboardEvent({
      type: 'health-change',
      payload: { source: 'report', servers: servers.length },
      timestamp: Date.now(),
    });
    container.db.close();

    const costScores = costs.map(c => ({ estimatedCostUSD: c.estimatedCostUSD, pricingModel: c.pricingModel }));
    const overallScore = calculateOverallScore(security, health, costScores);
    const configPath = opts.all ? `aggregated (${sourcePaths.length} files)` : (sourcePaths[0] || 'auto-detected');
    const fullReport: FullReport = { timestamp: new Date().toISOString(), configPath, security, costs, health, overallScore };
    const reporter = new ReportGenerator();

    let output: string;
    if (opts.format === 'json') output = JSON.stringify(fullReport, null, 2);
    else if (opts.format === 'markdown') output = reporter.toMarkdown(fullReport);
    else output = reporter.formatFullReport(fullReport);

    if (opts.output) {
      const fs = await import('fs');
      fs.writeFileSync(opts.output, output);
      console.error(chalk.green(`Report saved to ${opts.output}`));
    } else {
      console.log(output);
    }

    checkAlertThresholds(security, opts);
  });

const policyCmd = program
  .command('policy')
  .description('Policy utilities');

policyCmd
  .command('test')
  .description('Evaluate a single tools/call against a policy file (policy playground)')
  .requiredOption('--policy <path>', 'Policy YAML path')
  .requiredOption('--tool <name>', 'Tool name to evaluate')
  .option('--args <json>', 'Tool arguments JSON', '{}')
  .option('--server <name>', 'Server name label', 'policy-test')
  .option('--blocking-mode <mode>', 'Override policy mode: audit | warn | block')
  .action(async (opts: { policy: string; tool: string; args?: string; server?: string; blockingMode?: string }) => {
    try {
      const { runPolicyTest } = await import('./cli/policy-test.js');
      const result = runPolicyTest({
        policy: opts.policy,
        tool: opts.tool,
        args: opts.args || '{}',
        server: opts.server,
        blockingMode: opts.blockingMode,
      });
      console.log(JSON.stringify(result, null, 2));
    } catch (err: unknown) {
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });

policyCmd
  .command('provenance-verify')
  .description('Verify tamper-evident config provenance chain')
  .action(async () => {
    try {
      const { runProvenanceVerify } = await import('./cli/provenance-cmd.js');
      const result = await runProvenanceVerify();
      console.log(JSON.stringify(result, null, 2));
      if (!result.valid) process.exit(1);
    } catch (err: unknown) {
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });

policyCmd
  .command('provenance-export')
  .description('Export config provenance bundle (json | signed | tarball)')
  .option('--format <format>', 'json | signed | tarball', 'json')
  .option('--output <path>', 'Write to file instead of stdout')
  .action(async (opts: { format: string; output?: string }) => {
    try {
      const { runProvenanceExport } = await import('./cli/provenance-cmd.js');
      const format = ['json', 'signed', 'tarball'].includes(opts.format) ? opts.format as 'json' | 'signed' | 'tarball' : 'json';
      const bundle = await runProvenanceExport('default', { format, output: opts.output });
      if (!opts.output) console.log(JSON.stringify(bundle, null, 2));
      else console.error(`Wrote ${opts.output}`);
    } catch (err: unknown) {
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });

program
  .command('threat-model')
  .description('Generate STRIDE/LINDDUN threat model from MCP config')
  .requiredOption('--config <path>', 'MCP client config JSON path')
  .option('--format <format>', 'Output format: markdown | json', 'markdown')
  .option('--output <path>', 'Write output to file')
  .action(async (opts: { config: string; format: string; output?: string }) => {
    try {
      const { runThreatModelCli } = await import('./cli/threat-model-cmd.js');
      const fmt = opts.format === 'json' ? 'json' : 'markdown';
      const result = runThreatModelCli({ config: opts.config, format: fmt, output: opts.output });
      if (!opts.output) {
        if (result.markdown) console.log(result.markdown);
        else console.log(JSON.stringify(result.report, null, 2));
      } else {
        console.error(chalk.green(`Wrote ${opts.output}`));
      }
    } catch (err: unknown) {
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });

program
  .command('onboard')
  .description('Solo-developer onboarding: detect IDE MCP servers, wrap with audit policy, save status')
  .option('--client <name>', 'Client: cline, cursor, claude-desktop, windsurf, auto', 'auto')
  .option('-c, --config <path>', 'Explicit MCP client config path')
  .option('--policy <path>', 'Policy YAML for wrapped proxies', 'policy-audit.yaml')
  .option('--apply', 'Patch live client MCP JSON', false)
  .option(
    '--project-root <path>',
    'MCP Mastyf AI package root (dist/cli.js)',
    resolveMastyfAiInstallRoot(),
  )
  .option('--workspace-root <path>', 'Directory for mastyf-ai-configs output', process.cwd())
  .option('--skip <names>', 'Comma-separated server names to skip', 'mastyf-ai,mastyf-ai')
  .option('--start-proxy', 'Print command to start proxy for first wrapped server', false)
  .option('--start', 'Start proxy + dashboard after onboarding', false)
  .action(async (opts: {
    client: string;
    config?: string;
    policy: string;
    apply: boolean;
    projectRoot: string;
    workspaceRoot: string;
    skip: string;
    startProxy: boolean;
    start: boolean;
  }) => {
    const { runOnboardAndMaybeStart } = await import('./cli/onboard.js');
    type WrapClient = import('./wrap/client-wrap.js').WrapClient;
    const client = opts.client as WrapClient;
    const valid = ['cline', 'cursor', 'claude-desktop', 'windsurf', 'auto'];
    if (!valid.includes(client)) {
      console.error(chalk.red(`Invalid --client "${opts.client}". Use: ${valid.join(', ')}`));
      process.exit(1);
    }
    try {
      await runOnboardAndMaybeStart({
        client,
        configPath: opts.config,
        policyPath: opts.policy,
        projectRoot: opts.projectRoot,
        workspaceRoot: opts.workspaceRoot,
        apply: opts.apply,
        skipNames: opts.skip.split(',').map((s) => s.trim()).filter(Boolean),
        startProxy: opts.startProxy,
        start: opts.start,
      });
    } catch (err: unknown) {
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });

program
  .command('start')
  .description('Start MCP proxy + web dashboard (local defaults, http://localhost:4000)')
  .option('-c, --config <path>', 'Mastyf AI MCP config JSON (single stdio server)')
  .option('--policy <path>', 'Policy YAML (default: policy-audit.yaml from install root)')
  .option('--blocking-mode <mode>', 'Policy mode: audit, warn, block', 'block')
  .option('--build-dashboard', 'Build dashboard SPA before starting (git clone)')
  .action(async (opts: {
    config?: string;
    policy?: string;
    blockingMode: string;
    buildDashboard?: boolean;
  }) => {
    const { runStart } = await import('./cli/start.js');
    await runStart({
      config: opts.config,
      policy: opts.policy,
      blockingMode: opts.blockingMode,
      buildDashboard: opts.buildDashboard,
    });
  });

program
  .command('setup')
  .description('Developer setup: pnpm install, build server, build dashboard SPA (git clone only)')
  .option('--skip-dashboard', 'Skip dashboard SPA build', false)
  .option('--project-root <path>', 'Monorepo root', resolveMastyfAiInstallRoot())
  .action(async (opts: { skipDashboard?: boolean; projectRoot: string }) => {
    const { runSetup } = await import('./cli/setup.js');
    await runSetup({ projectRoot: opts.projectRoot, skipDashboard: opts.skipDashboard });
  });

program
  .command('wrap')
  .description('Wrap Cline/Cursor/Claude MCP servers with Mastyf AI proxy (per-server configs + optional client patch)')
  .option('--client <name>', 'Client config to wrap: cline, cursor, claude-desktop, windsurf, auto', 'auto')
  .option('-c, --config <path>', 'Explicit MCP client config path (overrides --client)')
  .option('--policy <path>', 'Policy YAML for wrapped proxies', 'policy-audit.yaml')
  .option('--apply', 'Patch live client MCP JSON (creates timestamped .bak backup)', false)
  .option(
    '--project-root <path>',
    'MCP Mastyf AI package root (dist/cli.js)',
    resolveMastyfAiInstallRoot(),
  )
  .option('--workspace-root <path>', 'Directory for mastyf-ai-configs output', process.cwd())
  .option('--skip <names>', 'Comma-separated server names to skip (default: mastyf-ai,mastyf-ai)', 'mastyf-ai,mastyf-ai')
  .action(async (opts: {
    client: string;
    config?: string;
    policy: string;
    apply: boolean;
    projectRoot: string;
    workspaceRoot: string;
    skip: string;
  }) => {
    const { runWrap } = await import('./wrap/client-wrap.js');
    type WrapClient = import('./wrap/client-wrap.js').WrapClient;
    const client = opts.client as WrapClient;
    const valid = ['cline', 'cursor', 'claude-desktop', 'windsurf', 'auto'];
    if (!valid.includes(client)) {
      console.error(chalk.red(`Invalid --client "${opts.client}". Use: ${valid.join(', ')}`));
      process.exit(1);
    }
    try {
      const result = runWrap({
        client,
        configPath: opts.config,
        projectRoot: opts.projectRoot,
        workspaceRoot: opts.workspaceRoot,
        policyPath: opts.policy,
        apply: opts.apply,
        skipNames: opts.skip.split(',').map((s) => s.trim()).filter(Boolean),
      });
      console.error(chalk.green(`\nWrapped ${result.wrapped.length} server(s): ${result.wrapped.join(', ') || '(none)'}`));
      if (result.skipped.length) {
        console.error(chalk.dim(`Skipped: ${result.skipped.join('; ')}`));
      }
      console.error(chalk.dim(`Per-server configs: ${result.configsDir}`));
      console.error(chalk.dim(`Wrapper script: ${result.wrapperScript}`));
      console.error(chalk.dim(`Example patched JSON: examples/${path.basename(result.clientConfigPath, '.json')}.wrapped.json`));
      if (result.backupPath) {
        console.error(chalk.yellow(`Backup: ${result.backupPath}`));
        console.error(chalk.green('Applied — reload MCP servers in your IDE (Cline: restart VS Code or reconnect MCP).'));
      } else if (result.wrapped.length > 0) {
        console.error(chalk.yellow('\nDry-run only. Re-run with --apply to patch your live client config.'));
      }
    } catch (err: unknown) {
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });

const aiCmd = program
  .command('ai')
  .description('AI learning utilities (rollback, diagnostics)');

aiCmd
  .command('rollback')
  .description('Restore AI learning state from the latest pre-cycle snapshot')
  .action(() => {
    import('./ai/suggestion-engine.js').then(({ rollbackAiLearning }) => {
      const result = rollbackAiLearning();
      if (result.ok) {
        console.log(chalk.green(`Rolled back to snapshot ${result.snapshotId}`));
        process.exit(0);
      }
      console.error(chalk.red(result.reason || 'Rollback failed'));
      process.exit(1);
    });
  });

program
  .command('doctor')
  .description('Check DB path, policy, dashboard/AI env — quick onboarding diagnostics')
  .option('--policy <path>', 'Policy YAML to verify', 'default-policy.yaml')
  .option('-c, --config <path>', 'Optional MCP config path to verify')
  .action((opts: { policy: string; config?: string }) => {
    import('./utils/doctor.js').then(({ runDoctor }) => {
      process.exit(runDoctor({ policyPath: opts.policy, configPath: opts.config }));
    });
  });

const fleetCmd = program.command('fleet').description('Fleet-wide observability across replicas');

fleetCmd
  .command('status')
  .description('Aggregate status from Postgres (DATABASE_URL) or MASTYF_AI_FLEET_DB_PATHS')
  .option('--json', 'Output JSON')
  .action(async (opts: { json?: boolean }) => {
    const { runFleetStatus } = await import('./cli/fleet-status.js');
    process.exit(await runFleetStatus(opts));
  });

const roadmapCmd = program.command('roadmap').description('Industry-standard roadmap utilities (A1–C5)');

roadmapCmd
  .command('fleet-graph-train')
  .description('Train GNN weights from fleet chain alerts and export JSON (A1)')
  .requiredOption('--output <path>', 'Write weights JSON (w1/w2 arrays)')
  .option('--db <path>', 'History DB path (default: MASTYF_AI_HISTORY_DB or :memory:)')
  .action(async (opts: { output: string; db?: string }) => {
    try {
      const { runRoadmapFleetGraphTrain } = await import('./cli/roadmap-cmd.js');
      runRoadmapFleetGraphTrain(opts);
      console.error(chalk.green(`Wrote graph weights to ${opts.output}`));
    } catch (err: unknown) {
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });

roadmapCmd
  .command('federated-export')
  .description('Export federated model bundle (B3)')
  .option('--output <path>', 'Write JSON bundle')
  .option('--db <path>', 'History DB path')
  .action(async (opts: { output?: string; db?: string }) => {
    try {
      const { runRoadmapFederatedExport } = await import('./cli/roadmap-cmd.js');
      const bundle = await runRoadmapFederatedExport(opts);
      if (!opts.output) console.log(JSON.stringify(bundle, null, 2));
      else console.error(chalk.green(`Wrote ${opts.output}`));
    } catch (err: unknown) {
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });

roadmapCmd
  .command('federated-import')
  .description('Import federated model bundle (B3)')
  .requiredOption('--input <path>', 'JSON bundle from federated-export')
  .option('--db <path>', 'History DB path')
  .action(async (opts: { input: string; db?: string }) => {
    try {
      const { runRoadmapFederatedImport } = await import('./cli/roadmap-cmd.js');
      runRoadmapFederatedImport(opts);
      console.error(chalk.green(`Imported federated model from ${opts.input}`));
    } catch (err: unknown) {
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });

roadmapCmd
  .command('observatory-sync')
  .description('Sync cloud + mesh observatory telemetry (B2)')
  .option('--db <path>', 'History DB path')
  .action(async (opts: { db?: string }) => {
    try {
      const { runRoadmapObservatorySync } = await import('./cli/roadmap-cmd.js');
      const result = await runRoadmapObservatorySync(opts);
      console.log(JSON.stringify(result, null, 2));
    } catch (err: unknown) {
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });

roadmapCmd
  .command('reputation-sync')
  .description('Pull mesh reputation entries (B1)')
  .option('--db <path>', 'History DB path')
  .action(async (opts: { db?: string }) => {
    try {
      const { runRoadmapReputationSync } = await import('./cli/roadmap-cmd.js');
      const count = await runRoadmapReputationSync(opts);
      console.log(JSON.stringify({ ingested: count }, null, 2));
    } catch (err: unknown) {
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });

roadmapCmd
  .command('audit')
  .description('Run industry-standard roadmap plan compliance audit (A1–C5, B1–B3)')
  .option('--json', 'Emit full JSON report')
  .action(async (opts: { json?: boolean }) => {
    try {
      const { runRoadmapPlanComplianceAudit } = await import('./cli/roadmap-cmd.js');
      const report = await runRoadmapPlanComplianceAudit();
      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(`Overall: ${report.overallScore}% | Production ready: ${report.productionReady}`);
        console.log(report.summary);
        for (const m of report.modules) {
          const failed = m.checks.filter(c => !c.passed).map(c => c.id);
          console.log(`  ${m.id} ${m.name}: ${m.score}%${failed.length ? ` (failed: ${failed.join(', ')})` : ''}`);
        }
      }
      process.exit(report.productionReady ? 0 : 1);
    } catch (err: unknown) {
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });

program
  .command('tui')
  .description('Launch interactive terminal dashboard with real-time metrics, AI insights, and audit trails')
  .option('--dashboard-url <url>', 'Merge live metrics from dashboard API (default: MASTYF_AI_DASHBOARD_URL or http://localhost:4000)')
  .option('--policy <path>', 'Policy YAML for Policy tab (default: MASTYF_AI_POLICY_PATH / default-policy.yaml)')
  .action(async (opts: { dashboardUrl?: string; policy?: string }) => {
    if (opts.policy) process.env.MASTYF_AI_POLICY_PATH = opts.policy;
    const { startTui } = await import('./tui/app.js');
    await startTui(opts.dashboardUrl);
  });

program
  .command('control-plane')
  .description('Start control-plane APIs for compiled policy distribution and governance services')
  .option('--port <port>', 'Control-plane port (default: CONTROL_PLANE_PORT or 3000)')
  .option('--policy <path>', 'Path to policy YAML file to compile for data plane')
  .action(async (opts: ControlPlaneOptions) => {
    const { startControlPlaneServer } = await import('./control-plane/server.js');
    const parsedPort = opts.port ? parseInt(opts.port, 10) : undefined;
    startControlPlaneServer({
      port: Number.isFinite(parsedPort as number) ? parsedPort : undefined,
      policyPath: opts.policy,
    });
  });

program
  .command('proxy')
  .description('Start MCP Mastyf AI proxy with optional OAuth 2.1 authentication and active policy enforcement')
  .option('-c, --config <path>', 'Path to MCP config file')
  .option('--policy <path>', 'Path to policy YAML file (enables active blocking)')
  .option('--blocking-mode <mode>', 'Override policy mode: audit (passive), warn (flag), block (enforce)', 'block')
  .option('--auth-issuer <url>', 'OIDC issuer URL for JWT validation (e.g., https://accounts.google.com)')
  .option('--auth-audience <aud>', 'Expected audience claim in JWT')
  .option('--auth-required', 'Require authentication for all tool calls (fail-closed)', false)
  .option('--dry-run', 'Simulate policy against historical call_records without activating the proxy')
  .option('--gateway', 'Shared ingress: SSE/WebSocket only (requires MASTYF_AI_MULTI_TENANT_ENABLED)', false)
  .action(async (opts: ProxyOptions) => {
    const paths = opts.config ? [opts.config] : ConfigParser.findConfigPaths();
    if (paths.length === 0) { console.error(chalk.red('No MCP config files found. Use --config to specify a path.')); process.exit(1); }

    const servers = ConfigParser.parse(paths[0]);
    if (servers.length === 0) { console.error(chalk.yellow('No servers found in config.')); process.exit(0); }

    if (opts.gateway) {
      process.env['MASTYF_AI_GATEWAY_MODE'] = 'true';
    }

    const stdioServerCount = servers.filter((s) => s.command).length;
    if (!opts.gateway && stdioServerCount > 1) {
      console.error(chalk.red(
        'Multiple stdio MCP servers in one proxy process are not supported.\n' +
        `  Found ${stdioServerCount} servers with "command" in ${paths[0]}.\n` +
        '  Use `mastyf-ai wrap` (one proxy per server) or pass a single-server config.\n' +
        '  See docs/REAL_WORLD_INTEGRATION.md',
      ));
      process.exit(1);
    }

    // ── --dry-run: simulate policy against historical call_records ──
    if (opts.dryRun) {
      if (!opts.policy) {
        console.error(chalk.red('--dry-run requires --policy to be specified'));
        process.exit(1);
      }
      // Load policy inline for dry-run (before policyEngine is declared in normal proxy path)
      let dryRunEngine: PolicyEngine;
      try {
        const { readFileSync } = await import('fs');
        const { load } = await import('js-yaml');
        const policyYaml = readFileSync(opts.policy, 'utf-8');
        const policyConfig = load(policyYaml) as PolicyConfig;
        if (opts.blockingMode && ['audit', 'warn', 'block'].includes(opts.blockingMode)) {
          policyConfig.policy.mode = opts.blockingMode as 'audit' | 'warn' | 'block';
        }
        dryRunEngine = new PolicyEngine(policyConfig);
      } catch (err: unknown) {
        console.error(chalk.red(`Failed to load policy for dry-run: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
      const db = new HistoryDatabase(process.env.MASTYF_AI_DB_PATH || undefined);
      let totalBlocked = 0;
      let totalPassed = 0;
      const perServer: Record<string, { blocked: number; passed: number }> = {};

      console.error(chalk.dim(`Dry-run: evaluating ${dryRunEngine.getMode()} policy against historical call records...\n`));

      for (const server of servers) {
        const records = await db.getCallRecordsForServer(server.name);
        perServer[server.name] = { blocked: 0, passed: 0 };

        for (const rec of records) {
          const context = {
            serverName: rec.serverName,
            toolName: rec.toolName,
            arguments: {},
            requestId: `dry-run-${rec.serverName}-${rec.toolName}`,
            requestTokens: rec.requestTokens,
            timestamp: new Date().toISOString(),
          };
          const decision = dryRunEngine.evaluate(context);
          if (decision.action === 'block') {
            perServer[server.name].blocked++;
            totalBlocked++;
          } else {
            perServer[server.name].passed++;
            totalPassed++;
          }
        }
      }

      // ── Print summary ────────────────────────────────────
      console.log(chalk.bold('\n📊 Dry-Run Results\n'));
      for (const [srv, counts] of Object.entries(perServer)) {
        const total = counts.blocked + counts.passed;
        const pct = total > 0 ? Math.round((counts.blocked / total) * 100) : 0;
        const color = pct > 50 ? chalk.red : pct > 10 ? chalk.yellow : chalk.green;
        console.log(`  ${srv}: ${color(`${counts.blocked} blocked`)}, ${counts.passed} passed (${pct}% block rate)`);
      }
      console.log(chalk.bold(`\n  Total: ${chalk.red(`${totalBlocked} would be blocked`)}, ${chalk.green(`${totalPassed} would pass`)}`));

      if (totalBlocked > 0) {
        console.log(chalk.yellow('\n💡 Tip: Use --blocking-mode audit first, then switch to warn, then block.'));
      }

      db.close();
      process.exit(0);
    }

    // Configure OAuth 2.1 if --auth-issuer provided
    let authValidator: OAuthValidator | undefined;
    if (opts.authIssuer) {
      if (!opts.authAudience) {
        console.error(chalk.red('--auth-audience is required when --auth-issuer is set'));
        process.exit(1);
      }
      const authConfig: AuthConfig = {
        issuer: opts.authIssuer,
        audience: opts.authAudience,
        required: opts.authRequired || false,
      };
      authValidator = new OAuthValidator(authConfig);
      console.error(chalk.green(`OAuth 2.1 enabled: ${authConfig.issuer} (audience: ${authConfig.audience})${authConfig.required ? ' [REQUIRED]' : ' [OPTIONAL]'}`));
    }

    // Load policy config if --policy flag provided
    let policyEngine: PolicyEngine | undefined;
    let policyWatcher: PolicyWatcher | undefined;
    let useWatcherForManager = false;
    if (opts.policy) {
      try {
        // Use PolicyWatcher for hot-reload + actual policy object for dashboard
        policyWatcher = new PolicyWatcher(opts.policy);
        policyEngine = policyWatcher.get() || undefined;
        useWatcherForManager = true; // Default: pass watcher so hot-reload works
        if (opts.blockingMode && ['audit', 'warn', 'block'].includes(opts.blockingMode) && policyEngine) {
          if (process.env['MASTYF_AI_DISALLOW_MODE_OVERRIDE'] === 'true') {
            console.error(chalk.yellow(
              `--blocking-mode ignored (MASTYF_AI_DISALLOW_MODE_OVERRIDE=true). Using policy file mode: ${policyEngine.getMode()}`,
            ));
          } else {
            const { load } = await import('js-yaml');
            const policyConfig = load(readFileSync(opts.policy, 'utf-8')) as PolicyConfig;
            policyConfig.policy.mode = opts.blockingMode as 'audit' | 'warn' | 'block';
            policyEngine = new PolicyEngine(policyConfig);
            useWatcherForManager = false;
            console.error(chalk.yellow(
              `Policy mode overridden in memory (file on disk unchanged): ${opts.blockingMode}`,
            ));
          }
        }
        console.error(chalk.green(`Policy loaded: ${opts.policy} (mode: ${policyEngine?.getMode() || 'none'})`));
        console.error(chalk.dim(`  ${policyEngine ? '5' : '0'} rule(s) active`));
      } catch (err: unknown) {
        console.error(chalk.red(`Failed to load policy: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    } else {
      console.error(chalk.dim('No policy file specified — running in audit-only mode'));
    }

    await bootstrapSecrets();
    const db = await createDatabase(process.env.MASTYF_AI_DB_PATH || undefined);
    await bootstrapCompliance(db);
    await bootstrapControlPlane(policyWatcher);
    const { loadDetectorPluginsFromPath } = await import('./plugins/detector-plugin.js');
    await loadDetectorPluginsFromPath();
    // Pass PolicyWatcher (not just engine) so hot-reload works
    // When mode override is active, pass the engine directly since the watcher was re-seeded
    const manager = new ProxyManager(db, useWatcherForManager ? policyWatcher : policyEngine, authValidator);
    await manager.startAll(servers);

    if (authValidator) {
      void authValidator.init().then(() => authValidator!.startBackgroundJwksRefresh()).catch(() => {});
    }

    const { runPreflightScanAndHealth } = await import('./utils/preflight-scan.js');
    runPreflightScanAndHealth(servers, db);

    // Start OpenTelemetry tracing if configured
    initTracing().catch(() => {});

    // Start Prometheus metrics server if enabled
    const metricsPort = parseInt(process.env['METRICS_PORT'] || '9090', 10);
    startMetricsServer(metricsPort).catch(() => {});

    // Create agentic container for live agentic API data
    const container = await createContainer();

    // Wire dashboard to real HistoryDatabase for live API data
    setDashboardDataSource(db);
    // Wire agentic AI container for live dashboard data
    setAgenticContainer(container);

    const rewireDashboardWs = async () => {
      const { getWsBroadcaster } = await import('./utils/dashboard-events.js');
      const { wireDashboardWsProviders } = await import('./utils/dashboard-ws-wire.js');
      wireDashboardWsProviders(getWsBroadcaster(), db);
    };

    if (process.env['DASHBOARD_ENABLED'] === undefined) {
      process.env['DASHBOARD_ENABLED'] = 'true';
    }
    if (process.env['DASHBOARD_AUTH_DISABLED'] === undefined) {
      process.env['DASHBOARD_AUTH_DISABLED'] = 'true';
    }
    if (process.env['MASTYF_AI_WS_ENABLED'] === undefined) {
      process.env['MASTYF_AI_WS_ENABLED'] = 'true';
    }
    if (process.env['MASTYF_AI_CI_BYPASS_LICENSE'] === undefined) {
      process.env['MASTYF_AI_CI_BYPASS_LICENSE'] = 'true';
    }
    if (process.env['MASTYF_AI_AGENTIC_ENABLED'] === undefined) {
      process.env['MASTYF_AI_AGENTIC_ENABLED'] = 'false';
    }
    const dashboardPort = parseInt(process.env['DASHBOARD_PORT'] || '4000', 10);
    const dashboardServerP = startDashboardServer(dashboardPort, policyWatcher);
    dashboardServerP
      .then(async ({ server: httpServer }) => {
        void rewireDashboardWs();
        if (httpServer && manager) {
          try {
            const { mountMcpEndpoint } = await import('./utils/mcp-http-bridge.js');
            mountMcpEndpoint(httpServer, '/mcp', manager);
          } catch (errMcp: unknown) {
            console.error(chalk.yellow(`MCP endpoint mount warning: ${errMcp instanceof Error ? errMcp.message : String(errMcp)}`));
          }
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(chalk.yellow(`Dashboard/WS server warning: ${msg}`));
      });

    // ─── Hot-reload UI-managed MCP servers ────────────────
    void (async () => {
      const { existsSync, readFileSync } = await import('fs');
      const { join } = await import('path');
      const { homedir } = await import('os');
      const { watch } = await import('chokidar');
      const configPath = join(homedir(), '.mastyf-ai', 'servers.json');
      const originalServers = servers;

      const mergeAndReload = async () => {
        try {
          const raw = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : '[]';
          const uiConfigs = JSON.parse(raw) as Array<{ name: string; command: string; args?: string[]; env?: Record<string, string>; disabled?: boolean }>;
          const uiServers: McpServerConfig[] = uiConfigs
            .filter((u) => !u.disabled)
            .map((u) => ({
              name: u.name,
              command: u.command,
              args: u.args || [],
              env: u.env,
              transport: 'stdio',
            }));
          const existingNames = new Set(originalServers.map((s) => s.name));
          const merged = [...originalServers, ...uiServers.filter((u) => !existingNames.has(u.name))];
          await manager.reloadServers(merged);
        } catch (err: unknown) {
          console.error(chalk.yellow(`Server config reload error: ${err instanceof Error ? err.message : String(err)}`));
        }
      };

      if (existsSync(configPath)) {
        watch(configPath, { awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 } }).on('change', () => {
          void mergeAndReload();
        });
        console.error(chalk.dim(`[watch] UI-managed MCP servers: ${configPath}`));
      }
    })();

    if (isAiLearningEnabled()) {
      const { initializeAiEngine } = await import('./ai/suggestion-engine.js');
      initializeAiEngine(db, servers)
        .then(() => void rewireDashboardWs())
        .catch((err: any) => {
          console.error(chalk.yellow(`AI learning engine warning: ${err instanceof Error ? err.message : String(err)}`));
        });
    } else {
      console.error(chalk.dim('AI learning disabled (MASTYF_AI_AI_ENABLED=false)'));
    }

    try {
      const { applyAutopilotEnv, isAutopilotMode } = await import('./utils/autopilot-profile.js');
      applyAutopilotEnv();
      const { startAutopilotServices } = await import('./utils/autopilot-services.js');
      const { resolveCliTenantId } = await import('./tenant/resolve-tenant.js');
      startAutopilotServices(db, resolveCliTenantId({}), servers);
      if (isAutopilotMode()) {
        console.error(chalk.green('Mastyf AI Autopilot services started (scheduler + reports)'));
      }
    } catch (err: unknown) {
      console.error(chalk.yellow(`Autopilot services warning: ${err instanceof Error ? err.message : String(err)}`));
    }

    console.error(chalk.green('MCP Mastyf AI proxy running. Press Ctrl+C to stop.'));
    const cleanup = async () => {
      try {
        const { drainProxyInflight } = await import('./proxy/proxy-shutdown.js');
        await drainProxyInflight();
      } catch {
        /* ignore */
      }
      authValidator?.stopBackgroundJwksRefresh?.();
      await manager.stopAll();
      try {
        const { stopReportScheduler } = await import('./utils/report-scheduler.js');
        const { stopScheduler } = await import('./utils/threat-discovery-scheduler.js');
        stopReportScheduler();
        stopScheduler();
        const { stopHealthProbeScheduler } = await import('./services/health-probe-scheduler.js');
        stopHealthProbeScheduler();
      } catch {
        /* ignore */
      }
      const { flushAuditWriteQueue } = await import('./database/audit-write-queue.js');
      await flushAuditWriteQueue();
      await shutdownEnterprise();
      await closeDashboardServer();
      await shutdownMetrics();
      await db.close();
      process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    const proxies = manager.getProxies();
    if (proxies.length > 1) {
      console.error(chalk.red('Internal error: multiple stdio proxies started; expected at most one.'));
      process.exit(1);
    }
    if (proxies.length === 1) {
      process.stdin.setEncoding('utf-8');
      let buffer = '';
      const stdinQueue = new AsyncSerialQueue();
      process.stdin.on('data', (chunk: string) => {
        buffer += chunk;
        while (buffer.includes('\n')) {
          const newlineIdx = buffer.indexOf('\n');
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);
          if (!line) continue;
          void stdinQueue.enqueue(async () => {
            try {
              await manager.dispatchStdioInput(line);
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : String(err);
              console.error(chalk.red(`Proxy stdin error: ${message}`));
            }
          });
        }
      });
    }
  });

// ── Default action: when piped stdin (Glama/mcp-proxy), start MCP server ──
const isPiped = !process.stdin.isTTY;
const isServer = process.env['MASTYF_AI_MODE'] === 'server';

program
  .command('analyze')
  .description('Full plain-English security and health analysis (optional Ollama narrative)')
  .option('--window <days>', 'Analysis window in days', '7')
  .option('--no-llm', 'Skip Ollama narrative (measured facts only)', false)
  .option('--output <path>', 'Save report to file')
  .option('-f, --format <format>', 'Output format: md (default) or json', 'md')
  .option('--tenant <id>', 'Tenant id (default: MASTYF_AI_TENANT_ID)')
  .option('--project-root <path>', 'Project root for default report paths', process.cwd())
  .action(async (opts: {
    window: string;
    noLlm: boolean;
    output?: string;
    format: string;
    tenant?: string;
    projectRoot: string;
  }) => {
    const { runAnalyze } = await import('./cli/analyze.js');
    const format = opts.format === 'json' ? 'json' : 'md';
    await runAnalyze({
      window: parseInt(opts.window, 10) || 7,
      noLlm: opts.noLlm,
      output: opts.output,
      format,
      tenantId: opts.tenant,
      projectRoot: opts.projectRoot,
    });
  });

program
  .command('bench')
  .description('Run Mastyf AI benchmark scorecard from harness/swarm reports')
  .option('--profile <name>', 'Benchmark profile name', 'enterprise')
  .option('--reports <dir>', 'Reports directory', join(process.cwd(), 'reports'))
  .option('--json', 'Output JSON only', false)
  .option('--persist', 'Save scorecard to local history.db', false)
  .option('--run-harness', 'Run adversarial harness before scoring', false)
  .action(async (opts: { profile: string; reports: string; json: boolean; persist: boolean; runHarness: boolean }) => {
    if (opts.runHarness) process.env.MASTYF_AI_BENCH_RUN_HARNESS = 'true';
    const { runHarnessThenScorecard, runMastyfAiBenchScorecard, persistBenchmarkScorecard } = await import('./utils/mastyf-ai-bench.js');
    const scorecard = opts.runHarness
      ? await runHarnessThenScorecard(opts.reports, opts.profile)
      : runMastyfAiBenchScorecard(opts.reports, opts.profile);
    if (opts.json) {
      console.log(JSON.stringify(scorecard, null, 2));
    } else {
      console.log(scorecard.summary);
      console.log(`Sources: ${scorecard.sources.join(', ') || 'none'}`);
    }
    if (opts.persist) {
      const { createDatabase } = await import('./database/create-database.js');
      const { IndustryStandardStore } = await import('./database/industry-standard-store.js');
      const db = await createDatabase(process.env.MASTYF_AI_DB_PATH);
      persistBenchmarkScorecard(new IndustryStandardStore(db), scorecard);
      console.log('Scorecard persisted to history.db');
    }
  });

const autopilotCmd = program
  .command('autopilot')
  .description('Plug-and-play autonomous protection, learning, and scheduled reports');

autopilotCmd
  .command('init')
  .description('Wrap MCP configs (block policy), write ~/.mastyf-ai/autopilot.json')
  .option('--client <name>', 'Client: cline, cursor, claude-desktop, windsurf, auto', 'auto')
  .option('-c, --config <path>', 'Explicit MCP client config path')
  .option('--apply', 'Patch live client MCP JSON', false)
  .option('--project-root <path>', 'MCP Mastyf AI repo root', process.cwd())
  .action(async (opts: {
    client: string;
    config?: string;
    apply: boolean;
    projectRoot: string;
  }) => {
    const { runAutopilotInit } = await import('./cli/autopilot.js');
    type WrapClient = import('./wrap/client-wrap.js').WrapClient;
    const client = opts.client as WrapClient;
    await runAutopilotInit({
      client,
      configPath: opts.config,
      projectRoot: opts.projectRoot,
      apply: opts.apply,
    });
  });

autopilotCmd
  .command('start')
  .description('Start proxy with Autopilot env (dashboard, learning, scheduler)')
  .option('-c, --config <path>', 'Mastyf AI MCP config JSON')
  .option('--policy <path>', 'Policy YAML', 'default-policy.yaml')
  .option('--project-root <path>', 'MCP Mastyf AI repo root', process.cwd())
  .action(async (opts: { config?: string; policy?: string; projectRoot: string }) => {
    const { runAutopilotStart } = await import('./cli/autopilot.js');
    runAutopilotStart(opts);
  });

autopilotCmd
  .command('status')
  .description('Show Autopilot protection, learning, and digest status')
  .action(async () => {
    const { runAutopilotStatus } = await import('./cli/autopilot.js');
    await runAutopilotStatus(false);
  });

program.action(async () => {
  if (isServer || isPiped) {
    const { startMcpServer } = await import('./index.js');
    await startMcpServer();
    return;
  }
  program.outputHelp();
});

program.parse();