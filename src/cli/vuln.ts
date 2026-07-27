/**
 * CLI: mastyf-ai vuln — unpublished vulnerability discovery commands
 */
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { ConfigParser } from '../config-parser.js';
import type { McpServerConfig } from '../types.js';

function loadServers(configPath?: string): McpServerConfig[] {
  if (configPath && existsSync(configPath)) {
    return ConfigParser.parse(configPath);
  }
  const paths = ConfigParser.findConfigPaths();
  if (paths.length) return ConfigParser.parse(paths[0]);
  const fleet = resolve(process.cwd(), 'mastyf-ai-configs');
  if (!existsSync(fleet)) return [];
  try {
    const files = readdirSync(fleet).filter((f) => f.endsWith('.json'));
    const servers: McpServerConfig[] = [];
    for (const f of files.slice(0, 20)) {
      try {
        servers.push(...ConfigParser.parse(resolve(fleet, f)));
      } catch {
        /* skip */
      }
    }
    return servers;
  } catch {
    return [];
  }
}

export async function runVulnCli(argv: {
  action: string;
  config?: string;
  id?: string;
  severity?: string;
  format?: string;
  force?: boolean;
  urls?: string;
  supplyChainOnly?: boolean;
  mcpFuzz?: boolean;
  viaProxy?: boolean;
}): Promise<number> {
  if (process.env.MASTYF_AI_VULN_DISCOVERY_ENABLED === undefined) {
    process.env.MASTYF_AI_VULN_DISCOVERY_ENABLED = 'true';
  }
  if (
    !process.env.MASTYF_AI_VULN_DISCOVERY_ALLOWLIST &&
    (argv.action === 'probe' || argv.action === 'run' || argv.action === 'agentic-run')
  ) {
    process.env.MASTYF_AI_VULN_DISCOVERY_ALLOWLIST = 'localhost,127.0.0.1';
  }

  const {
    runVulnDiscovery,
    runAgenticVulnDiscovery,
    proposeBlockFromFinding,
    listFindings,
    getFinding,
    validateFinding,
    rejectFinding,
    markDisclosed,
    analyzeFinding,
    analyzeAll,
    loadReport,
    approveAnalysisReport,
    probeUpstreamApis,
    purgeNoiseFindings,
  } = await import('../vuln-discovery/index.js');

  switch (argv.action) {
    case 'run': {
      const servers = loadServers(argv.config);
      if (!servers.length) {
        console.error(chalk.red('No MCP servers found. Pass --config <path>.'));
        return 1;
      }
      const urls = argv.urls?.split(',').map((s) => s.trim()).filter(Boolean) || [];
      for (const s of servers) {
        if (s.url) urls.push(s.url);
      }
      console.log(chalk.cyan(`Running vuln discovery on ${servers.length} server(s)...`));
      const result = await runVulnDiscovery({
        servers,
        upstreamUrls: [...new Set(urls)],
        supplyChainOnly: !!argv.supplyChainOnly && !argv.mcpFuzz,
        skipSast: !!argv.supplyChainOnly && !argv.mcpFuzz,
        skipUpstream: !!argv.supplyChainOnly && !argv.mcpFuzz,
        mcpFuzz: !!argv.mcpFuzz || (!argv.supplyChainOnly && process.env.MASTYF_AI_VULN_MCP_FUZZ === 'true'),
        viaProxy: !!argv.viaProxy || process.env.MASTYF_AI_VULN_FUZZ_VIA_PROXY === 'true',
        autoValidate: true,
        autoAnalyze: process.env.MASTYF_AI_VULN_ANALYSIS_AUTO_ON_VALIDATE !== 'false',
      });
      console.log(JSON.stringify(result.summary, null, 2));
      console.log(chalk.green(`Findings total: ${result.findings.length}`));
      return result.summary.errors.includes('disabled') ? 1 : 0;
    }

    case 'agentic-run': {
      process.env.MASTYF_AI_VULN_AGENTIC = 'true';
      process.env.MASTYF_AI_VULN_DISCOVERY_FORCE = 'true';
      const servers = loadServers(argv.config);
      if (!servers.length) {
        console.error(chalk.red('No MCP servers found. Pass --config <path>.'));
        return 1;
      }
      const urls = argv.urls?.split(',').map((s) => s.trim()).filter(Boolean) || [];
      for (const s of servers) {
        if (s.url) urls.push(s.url);
      }
      console.log(chalk.cyan(`Agentic VDE on ${servers.length} server(s)...`));
      const result = await runAgenticVulnDiscovery({
        servers,
        upstreamUrls: [...new Set(urls)],
        supplyChainOnly: !!argv.supplyChainOnly && !argv.mcpFuzz,
        mcpFuzz: !!argv.mcpFuzz || (!argv.supplyChainOnly && process.env.MASTYF_AI_VULN_MCP_FUZZ === 'true'),
        viaProxy: !!argv.viaProxy || process.env.MASTYF_AI_VULN_FUZZ_VIA_PROXY === 'true',
        useLlmForBlock: process.env.MASTYF_AI_LLM_ENABLED !== 'false',
      });
      console.log(JSON.stringify(result, null, 2));
      return result.errors.some((e) => e.includes('disabled')) ? 1 : 0;
    }

    case 'list': {
      const findings = listFindings({
        minSeverity: (argv.severity as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO') || undefined,
      });
      if (argv.format === 'json') {
        console.log(JSON.stringify(findings, null, 2));
      } else {
        for (const f of findings) {
          console.log(
            `${f.severity.padEnd(8)} ${f.status.padEnd(10)} ${f.class.padEnd(14)} ${f.id}  ${f.title.slice(0, 80)}`,
          );
        }
        console.log(chalk.dim(`\n${findings.length} finding(s)`));
      }
      return 0;
    }

    case 'show': {
      if (!argv.id) {
        console.error(chalk.red('Usage: vuln show <id>'));
        return 1;
      }
      const f = getFinding(argv.id);
      if (!f) {
        console.error(chalk.red(`Finding not found: ${argv.id}`));
        return 1;
      }
      console.log(JSON.stringify(f, null, 2));
      const report = loadReport(argv.id);
      if (report) {
        console.log(chalk.cyan('\n--- Analysis Report ---\n'));
        console.log(report.fullText);
      }
      return 0;
    }

    case 'validate': {
      if (!argv.id) {
        console.error(chalk.red('Usage: vuln validate <id>'));
        return 1;
      }
      const r = validateFinding(argv.id, { llmConfirmation: argv.force });
      if (!r) {
        console.error(chalk.red(`Finding not found: ${argv.id}`));
        return 1;
      }
      console.log(JSON.stringify(r, null, 2));
      if (r.promoted && process.env.MASTYF_AI_VULN_ANALYSIS_AUTO_ON_VALIDATE !== 'false') {
        const report = await analyzeFinding(argv.id);
        if (report) {
          console.log(chalk.green(`Analysis written: ${report.id}`));
          if (argv.format !== 'json') console.log(report.fullText);
        }
        const block = await proposeBlockFromFinding(argv.id);
        if (block.ok) {
          console.log(chalk.cyan(`Block proposal: ${block.candidateId} (Accept in Threat Lab)`));
        }
      }
      return r.promoted ? 0 : 1;
    }

    case 'reject': {
      if (!argv.id) {
        console.error(chalk.red('Usage: vuln reject <id>'));
        return 1;
      }
      const f = rejectFinding(argv.id, 'cli reject');
      console.log(f ? chalk.yellow(`Rejected ${f.id}`) : chalk.red('Not found'));
      return f ? 0 : 1;
    }

    case 'disclose': {
      if (!argv.id) {
        console.error(chalk.red('Usage: vuln disclose <id>'));
        return 1;
      }
      try {
        const f = markDisclosed(argv.id, process.env.MASTYF_AI_DISCLOSE_CVE);
        console.log(f ? chalk.green(`Disclosed ${f.id}`) : chalk.red('Not found'));
        return f ? 0 : 1;
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        return 1;
      }
    }

    case 'approve-analysis': {
      if (!argv.id) {
        console.error(chalk.red('Usage: vuln approve-analysis <id>'));
        return 1;
      }
      const report = approveAnalysisReport(argv.id);
      console.log(report ? chalk.green(`Analysis final: ${report.id}`) : chalk.red('No report'));
      return report ? 0 : 1;
    }

    case 'propose-block': {
      if (!argv.id) {
        console.error(chalk.red('Usage: vuln propose-block <id>'));
        return 1;
      }
      const block = await proposeBlockFromFinding(argv.id);
      console.log(JSON.stringify(block, null, 2));
      return block.ok ? 0 : 1;
    }

    case 'analyze': {
      if (!argv.id || argv.id === 'all') {
        const reports = await analyzeAll({
          minSeverity: (argv.severity as 'HIGH') || 'HIGH',
          status: 'validated',
        });
        console.log(chalk.green(`Analyzed ${reports.length} finding(s)`));
        return 0;
      }
      const report = await analyzeFinding(argv.id, { force: argv.force });
      if (!report) {
        console.error(chalk.red('Analysis failed or finding not found'));
        return 1;
      }
      if (argv.format === 'json') console.log(JSON.stringify(report, null, 2));
      else console.log(report.fullText);
      return 0;
    }

    case 'prepare-disclosure': {
      if (!argv.id) {
        console.error(chalk.red('Usage: vuln prepare-disclosure <id>'));
        return 1;
      }
      const { prepareDisclosurePackage } = await import('../vuln-discovery/disclosure-package.js');
      try {
        const pkg = await prepareDisclosurePackage(argv.id, { forceAnalyze: !!argv.force });
        console.log(JSON.stringify({
          findingId: pkg.findingId,
          vendorReady: pkg.vendorReady,
          preview: pkg.preview,
          cveStatus: pkg.cveStatus,
          relatedCve: pkg.relatedCve,
          paths: pkg.paths,
          builtAt: pkg.builtAt,
        }, null, 2));
        console.log(chalk.green(`Disclosure package at ${pkg.paths.dir}`));
        return 0;
      } catch (err: unknown) {
        console.error(chalk.red(err instanceof Error ? err.message : 'prepare-disclosure failed'));
        return 1;
      }
    }

    case 'export': {
      if (!argv.id) {
        console.error(chalk.red('Usage: vuln export <id> [--format md|txt|json|zip]'));
        return 1;
      }
      const {
        buildDisclosurePackage,
        prepareDisclosurePackage,
        readDisclosurePackageZip,
      } = await import('../vuln-discovery/disclosure-package.js');
      try {
        let pkg;
        try {
          pkg = await buildDisclosurePackage(argv.id);
        } catch {
          pkg = await prepareDisclosurePackage(argv.id);
        }
        const format = argv.format || 'md';
        if (format === 'json') {
          console.log(JSON.stringify(pkg, null, 2));
          return 0;
        }
        if (format === 'zip') {
          const zip = readDisclosurePackageZip(argv.id);
          if (!zip || !pkg.paths.zip) {
            console.error(chalk.red('Zip not built'));
            return 1;
          }
          const { writeFileSync } = await import('node:fs');
          const out = `${argv.id}-disclosure.zip`;
          writeFileSync(out, zip);
          console.log(chalk.green(`Wrote ${out}`));
          return 0;
        }
        if (format === 'txt') {
          console.log(pkg.report.fullText.replace(/^#+\s*/gm, '').replace(/^>\s*/gm, ''));
        } else {
          console.log(pkg.report.fullText);
        }
        console.log('\n## Disclosure package\n');
        console.log(`- Path: \`${pkg.paths.dir}\``);
        console.log(`- CVE status: ${pkg.cveStatus}${pkg.relatedCve ? ` (${pkg.relatedCve})` : ''}`);
        console.log(`- Vendor ready: ${pkg.vendorReady}`);
        if (pkg.acceptedPolicyRuleId) console.log(`- Accepted policy rule: \`${pkg.acceptedPolicyRuleId}\``);
        if (pkg.corpusFixtureId) console.log(`- Corpus fixture: \`${pkg.corpusFixtureId}\``);
        return 0;
      } catch (err: unknown) {
        console.error(chalk.red(err instanceof Error ? err.message : 'export failed'));
        return 1;
      }
    }

    case 'purge-noise': {
      const { clearCveCheckerMemoryCache } = await import('../scanners/cve-checker.js');
      const result = purgeNoiseFindings();
      clearCveCheckerMemoryCache();
      console.log(JSON.stringify(result, null, 2));
      console.log(
        chalk.yellow(
          `Rejected ${result.rejected} noisy finding(s); deleted ${result.deletedCaches.length} NVD cache file(s).`,
        ),
      );
      if (result.deletedCaches.length) {
        console.log(chalk.dim(`Caches removed: ${result.deletedCaches.join(', ')}`));
      }
      return 0;
    }

    case 'probe': {
      const urls = argv.urls?.split(',').map((s) => s.trim()).filter(Boolean) || [];
      if (!urls.length) {
        console.error(chalk.red('Usage: vuln probe --urls https://...'));
        return 1;
      }
      const results = await probeUpstreamApis(urls);
      console.log(JSON.stringify(results, null, 2));
      return 0;
    }

    default:
      console.error(
        chalk.red(
          `Unknown action: ${argv.action}. Use: run|agentic-run|list|show|validate|reject|disclose|approve-analysis|propose-block|analyze|prepare-disclosure|export|probe|purge-noise`,
        ),
      );
      return 1;
  }
}
