#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { ConfigParser } from './config-parser.js';
import { SecurityScanner } from './services/security-scanner.js';
import { CostAuditor } from './services/cost-auditor.js';
import { HealthMonitor } from './services/health-monitor.js';
import { HistoryDatabase } from './database/history-db.js';
import { ReportGenerator } from './reporter/report-generator.js';
import { FullReport } from './types.js';

const program = new Command();
program
  .name('mcp-doctor')
  .description('Security, cost, and health audit for MCP infrastructure')
  .version('0.1.0');

program
  .command('scan')
  .description('Run security scan on MCP servers')
  .option('-c, --config <path>', 'Path to an MCP config file')
  .action(async (options) => {
    const paths = options.config ? [options.config] : ConfigParser.findConfigPaths();
    if (paths.length === 0) {
      console.error(chalk.red('No MCP config files found. Use --config to specify a path.'));
      process.exit(1);
    }
    console.error(chalk.dim(`Using config: ${paths[0]}`));
    const servers = ConfigParser.parse(paths[0]);
    if (servers.length === 0) {
      console.error(chalk.yellow('No servers found in config.'));
      process.exit(0);
    }
    const scanner = new SecurityScanner();
    const reports = await Promise.all(servers.map((s) => scanner.scanServer(s)));

    // Store in DB
    const db = new HistoryDatabase();
    await Promise.all(reports.map((r) => db.addSecurityScan(r.serverName, r.score, r.cves.length, r)));
    db.close();

    console.log(new ReportGenerator().formatSecurityReports(reports));
  });

program
  .command('audit')
  .description('Audit token costs for MCP servers')
  .option('-c, --config <path>', 'Path to an MCP config file')
  .option('-s, --server <name>', 'Filter to a specific server')
  .action(async (options) => {
    const paths = options.config ? [options.config] : ConfigParser.findConfigPaths();
    if (paths.length === 0) {
      console.error(chalk.red('No MCP config files found. Use --config to specify a path.'));
      process.exit(1);
    }
    const servers = ConfigParser.parse(paths[0]);
    const filtered = options.server ? servers.filter((s) => s.name === options.server) : servers;
    if (filtered.length === 0) {
      console.error(chalk.yellow('No servers found.'));
      process.exit(0);
    }

    const auditor = new CostAuditor();
    const results = await Promise.all(filtered.map((s) => auditor.auditServer(s)));
    auditor.dispose();

    const db = new HistoryDatabase();
    await Promise.all(results.map((r) => db.addCostRecord(r.serverName, r.tokensUsed, r.estimatedCostUSD)));
    db.close();

    console.log(new ReportGenerator().formatCostReports(results));
  });

program
  .command('health')
  .description('Check health of MCP servers')
  .option('-c, --config <path>', 'Path to an MCP config file')
  .option('-s, --server <name>', 'Filter to a specific server')
  .action(async (options) => {
    const paths = options.config ? [options.config] : ConfigParser.findConfigPaths();
    if (paths.length === 0) {
      console.error(chalk.red('No MCP config files found. Use --config to specify a path.'));
      process.exit(1);
    }
    const servers = ConfigParser.parse(paths[0]);
    const filtered = options.server ? servers.filter((s) => s.name === options.server) : servers;
    if (filtered.length === 0) {
      console.error(chalk.yellow('No servers found.'));
      process.exit(0);
    }

    const db = new HistoryDatabase();
    const monitor = new HealthMonitor(db);
    const results = await Promise.all(filtered.map((s) => monitor.checkServer(s)));

    await Promise.all(results.map((r) => db.addHealthCheck(r.serverName, r.latencyMs, r.successRate > 0.5, r.toolCount)));
    db.close();

    console.log(new ReportGenerator().formatHealthReports(results));
  });

program
  .command('report')
  .description('Generate a full MCP Doctor report')
  .option('-c, --config <path>', 'Path to an MCP config file')
  .option('-f, --format <format>', 'Output format: text (default), markdown, or json', 'text')
  .action(async (options) => {
    const paths = options.config ? [options.config] : ConfigParser.findConfigPaths();
    if (paths.length === 0) {
      console.error(chalk.red('No MCP config files found. Use --config to specify a path.'));
      process.exit(1);
    }
    console.error(chalk.dim(`Using config: ${paths[0]}`));
    const servers = ConfigParser.parse(paths[0]);
    if (servers.length === 0) {
      console.error(chalk.yellow('No servers found in config.'));
      process.exit(0);
    }

    const db = new HistoryDatabase();
    const scanner = new SecurityScanner();
    const auditor = new CostAuditor();
    const monitor = new HealthMonitor(db);

    const [security, costs, health] = await Promise.all([
      Promise.all(servers.map((s) => scanner.scanServer(s))),
      Promise.all(servers.map((s) => auditor.auditServer(s))),
      Promise.all(servers.map((s) => monitor.checkServer(s))),
    ]);
    auditor.dispose();

    // Store all results (await all async DB operations)
    await Promise.all([
      ...security.map((r) => db.addSecurityScan(r.serverName, r.score, r.cves.length, r)),
      ...costs.map((r) => db.addCostRecord(r.serverName, r.tokensUsed, r.estimatedCostUSD)),
      ...health.map((r) => db.addHealthCheck(r.serverName, r.latencyMs, r.successRate > 0.5, r.toolCount)),
    ]);
    db.close();

    const overallScore = calculateOverallScore(security, health);
    const fullReport: FullReport = {
      timestamp: new Date().toISOString(),
      configPath: paths[0],
      security,
      costs,
      health,
      overallScore,
    };

    const reporter = new ReportGenerator();
    const format = options.format as string;
    if (format === 'json') {
      console.log(JSON.stringify(fullReport, null, 2));
    } else if (format === 'markdown') {
      console.log(reporter.toMarkdown(fullReport));
    } else {
      console.log(reporter.formatFullReport(fullReport));
    }
  });

function calculateOverallScore(
  security: { score: number }[],
  health: { successRate: number }[]
): number {
  if (security.length === 0 && health.length === 0) return 0;
  const secAvg = security.length > 0
    ? security.reduce((sum, s) => sum + s.score, 0) / security.length
    : 0;
  const healthAvg = health.length > 0
    ? health.reduce((sum, h) => sum + h.successRate * 100, 0) / health.length
    : 0;
  if (security.length === 0) return Math.round(healthAvg);
  if (health.length === 0) return Math.round(secAvg);
  return Math.round((secAvg + healthAvg) / 2);
}

program.parse();