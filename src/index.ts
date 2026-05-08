#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ConfigParser } from './config-parser.js';
import { SecurityScanner } from './services/security-scanner.js';
import { CostAuditor } from './services/cost-auditor.js';
import { HealthMonitor } from './services/health-monitor.js';
import { HistoryDatabase } from './database/history-db.js';
import { ReportGenerator } from './reporter/report-generator.js';
import { FullReport } from './types.js';

const server = new Server(
  { name: 'mcp-doctor', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

const db = new HistoryDatabase();
const securityScanner = new SecurityScanner();
const costAuditor = new CostAuditor();
const healthMonitor = new HealthMonitor(db);
const reporter = new ReportGenerator();

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'scan_security',
      description: 'Scan MCP server configurations for security vulnerabilities (CVEs, auth, typo-squatting, secrets)',
      inputSchema: {
        type: 'object',
        properties: {
          configPath: { type: 'string', description: 'Path to an MCP config file. If omitted, auto-discovers configs.' },
        },
      },
    },
    {
      name: 'audit_costs',
      description: 'Audit token usage and estimate costs per MCP server',
      inputSchema: {
        type: 'object',
        properties: {
          serverName: { type: 'string', description: 'Filter to a specific server name. If omitted, audits all.' },
        },
      },
    },
    {
      name: 'check_health',
      description: 'Check health, latency, and reliability of MCP servers',
      inputSchema: {
        type: 'object',
        properties: {
          serverName: { type: 'string', description: 'Filter to a specific server name. If omitted, checks all.' },
        },
      },
    },
    {
      name: 'full_report',
      description: 'Generate a complete security, cost, and health report for all MCP servers',
      inputSchema: {
        type: 'object',
        properties: {
          configPath: { type: 'string', description: 'Path to MCP config file (optional)' },
          format: { type: 'string', enum: ['json', 'markdown', 'text'], description: 'Output format (default: text)' },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Determine config paths
  const configPaths = args?.configPath ? [args.configPath as string] : ConfigParser.findConfigPaths();
  if (configPaths.length === 0) {
    return {
      content: [{ type: 'text', text: 'No MCP config files found. Please specify a configPath.' }],
    };
  }
  const servers = ConfigParser.parse(configPaths[0]);

  switch (name) {
    case 'scan_security': {
      const results = await Promise.all(servers.map((s) => securityScanner.scanServer(s)));
      for (const r of results) {
        db.addSecurityScan(r.serverName, r.score, r.cves.length, r);
      }
      return { content: [{ type: 'text', text: reporter.formatSecurityReports(results) }] };
    }

    case 'audit_costs': {
      const filtered = args?.serverName ? servers.filter((s) => s.name === args.serverName) : servers;
      const results = await Promise.all(filtered.map((s) => costAuditor.auditServer(s)));
      for (const r of results) {
        db.addCostRecord(r.serverName, r.tokensUsed, r.estimatedCostUSD);
      }
      return { content: [{ type: 'text', text: reporter.formatCostReports(results) }] };
    }

    case 'check_health': {
      const filtered = args?.serverName ? servers.filter((s) => s.name === args.serverName) : servers;
      const results = await Promise.all(filtered.map((s) => healthMonitor.checkServer(s)));
      for (const r of results) {
        db.addHealthCheck(r.serverName, r.latencyMs, r.successRate > 0.5, r.toolCount);
      }
      return { content: [{ type: 'text', text: reporter.formatHealthReports(results) }] };
    }

    case 'full_report': {
      const [security, costs, health] = await Promise.all([
        Promise.all(servers.map((s) => securityScanner.scanServer(s))),
        Promise.all(servers.map((s) => costAuditor.auditServer(s))),
        Promise.all(servers.map((s) => healthMonitor.checkServer(s))),
      ]);
      const overallScore = calculateOverallScore(security, health);
      const fullReport: FullReport = {
        timestamp: new Date().toISOString(),
        configPath: configPaths[0],
        security,
        costs,
        health,
        overallScore,
      };

      // Store results in DB
      for (const r of security) db.addSecurityScan(r.serverName, r.score, r.cves.length, r);
      for (const r of costs) db.addCostRecord(r.serverName, r.tokensUsed, r.estimatedCostUSD);
      for (const r of health) db.addHealthCheck(r.serverName, r.latencyMs, r.successRate > 0.5, r.toolCount);

      const format = (args?.format as string) ?? 'text';
      let output: string;
      if (format === 'markdown') {
        output = reporter.toMarkdown(fullReport);
      } else if (format === 'json') {
        output = JSON.stringify(fullReport, null, 2);
      } else {
        output = reporter.formatFullReport(fullReport);
      }
      return { content: [{ type: 'text', text: output }] };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP Doctor running on stdio');
}

main().catch((err) => {
  console.error('MCP Doctor failed to start:', err);
  process.exit(1);
});