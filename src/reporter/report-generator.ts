import chalk from 'chalk';
import { FullReport, SecurityReport, CostReport, HealthReport } from '../types.js';

export class ReportGenerator {
  formatSecurityReports(reports: SecurityReport[]): string {
    let out = chalk.bold.underline('\n🔒 Security Scan Results\n');
    for (const r of reports) {
      const grade = r.score >= 80 ? 'A' : r.score >= 60 ? 'B' : r.score >= 40 ? 'C' : 'D';
      const gradeColor = r.score >= 80 ? chalk.green : r.score >= 60 ? chalk.yellow : chalk.red;
      out += `\n${chalk.bold(r.serverName)} - Score: ${gradeColor(grade)} (${r.score})\n`;

      if (r.cves.length > 0) {
        out += `  CVEs: ${chalk.red(String(r.cves.length))} found\n`;
        for (const c of r.cves) {
          const sevColor = c.severity === 'CRITICAL' ? chalk.red : c.severity === 'HIGH' ? chalk.yellow : chalk.gray;
          out += `    ${sevColor(`[${c.severity}]`)} ${c.id}: ${c.summary.substring(0, 80)}\n`;
        }
      } else {
        out += `  CVEs: ${chalk.green('None')}\n`;
      }

      if (!r.authStatus.hasAuthentication) out += `  ${chalk.red('⚠ No authentication detected')}\n`;
      if (!r.authStatus.isTransportEncrypted) out += `  ${chalk.yellow('⚠ Transport not encrypted')}\n`;
      if (r.typoSquatRisk.length > 0) {
        out += `  ${chalk.red('⚠ Possible typo-squatting detected:')}\n`;
        for (const t of r.typoSquatRisk) {
          out += `    "${t.suspiciousName}" → similar to "${t.similarityTo}" (distance: ${t.distance})\n`;
        }
      }
      if (r.secretsFound.length > 0) {
        out += `  ${chalk.red(`⚠ ${r.secretsFound.length} hardcoded secret(s) detected`)}\n`;
        for (const s of r.secretsFound) {
          out += `    ${chalk.yellow(s.type)} in ${s.location}\n`;
        }
      }

      if (r.recommendations.length > 0) {
        out += `  ${chalk.cyan('Recommendations:')}\n`;
        for (const rec of r.recommendations) {
          out += `    - ${rec}\n`;
        }
      }
    }
    return out;
  }

  formatCostReports(reports: CostReport[]): string {
    let out = chalk.bold.underline('\n💰 Cost Audit\n');
    for (const r of reports) {
      out += `\n${chalk.bold(r.serverName)}: ${chalk.yellow(String(r.tokensUsed))} tokens, ${chalk.green(`$${r.estimatedCostUSD.toFixed(4)}`)} (${r.pricingModel})\n`;
      out += `  Input: ${r.inputTokens} tokens, Output: ${r.outputTokens} tokens\n`;
      for (const t of r.toolBreakdown) {
        out += `  ${chalk.dim(t.toolName)}: ${t.tokens} tokens, ${t.calls} calls, $${t.cost.toFixed(4)}\n`;
      }
      if (r.note) out += `  ${chalk.dim('ℹ️ ' + r.note)}\n`;
    }
    const grandTotal = reports.reduce((sum, r) => sum + r.estimatedCostUSD, 0);
    out += `\n${chalk.bold(`Total estimated cost: $${grandTotal.toFixed(4)}`)}\n`;
    return out;
  }

  formatHealthReports(reports: HealthReport[]): string {
    let out = chalk.bold.underline('\n❤️ Health Check\n');
    for (const r of reports) {
      const latencyColor = r.latencyMs > 2000 ? chalk.red : r.latencyMs > 500 ? chalk.yellow : chalk.green;
      const successColor = r.successRate >= 0.9 ? chalk.green : r.successRate >= 0.7 ? chalk.yellow : chalk.red;
      out += `\n${chalk.bold(r.serverName)}: ${latencyColor(`${r.latencyMs}ms`)} latency, ${successColor(`${(r.successRate * 100).toFixed(0)}%`)} success\n`;
      out += `  Tools: ${r.toolCount}, Context Pressure: ${(r.contextPressure * 100).toFixed(0)}%\n`;
      if (r.overloadWarning) out += `  ${chalk.yellow(`⚠ Tool overload: ${r.toolCount} tools may confuse agents`)}\n`;
      for (const rec of r.recommendations) {
        out += `  - ${rec}\n`;
      }
    }
    return out;
  }

  formatFullReport(report: FullReport): string {
    return (
      chalk.bold.cyan(`\n═══════════════════════════════════════════\n`) +
      chalk.bold.cyan(`  MCP Guardian Report\n`) +
      chalk.bold.cyan(`  ${report.timestamp}\n`) +
      chalk.bold.cyan(`  Config: ${report.configPath}\n`) +
      chalk.bold.cyan(`═══════════════════════════════════════════\n`) +
      this.formatSecurityReports(report.security) +
      this.formatCostReports(report.costs) +
      this.formatHealthReports(report.health) +
      `\n${chalk.bold.cyan('Overall Score: ')}${chalk.bold.white(`${report.overallScore}/100`)}\n`
    );
  }

  toMarkdown(report: FullReport): string {
    let md = `# MCP Guardian Report\n\n**Timestamp:** ${report.timestamp}  \n**Overall Score:** ${report.overallScore}/100\n\n`;

    md += `## 🔒 Security\n\n`;
    for (const s of report.security) {
      md += `### ${s.serverName} — Score: ${s.score}\n\n`;
      if (s.cves.length > 0) {
        md += `| CVE | Severity | Summary |\n|-----|----------|--------|\n`;
        for (const cve of s.cves) {
          md += `| ${cve.id} | ${cve.severity} | ${cve.summary.substring(0, 100)} |\n`;
        }
        md += '\n';
      }
      if (!s.authStatus.hasAuthentication) md += `⚠️ No authentication detected\n\n`;
      if (!s.authStatus.isTransportEncrypted) md += `⚠️ Transport not encrypted\n\n`;
      if (s.typoSquatRisk.length > 0) {
        md += `⚠️ **Typo-squat risks:**\n`;
        for (const t of s.typoSquatRisk) {
          md += `- \`${t.suspiciousName}\` similar to \`${t.similarityTo}\` (distance ${t.distance})\n`;
        }
        md += '\n';
      }
      if (s.secretsFound.length > 0) {
        md += `⚠️ **Secrets found:**\n`;
        for (const sec of s.secretsFound) {
          md += `- \`${sec.type}\` in \`${sec.location}\`\n`;
        }
        md += '\n';
      }
      if (s.recommendations.length > 0) {
        md += `**Recommendations:**\n`;
        for (const rec of s.recommendations) md += `- ${rec}\n`;
        md += '\n';
      }
    }

    md += `## 💰 Costs\n\n`;
    for (const c of report.costs) {
      md += `### ${c.serverName} — ${c.tokensUsed} tokens → $${c.estimatedCostUSD.toFixed(4)}\n\n`;
      md += `| Tool | Calls | Tokens | Cost |\n|------|-------|--------|------|\n`;
      for (const t of c.toolBreakdown) {
        md += `| ${t.toolName} | ${t.calls} | ${t.tokens} | $${t.cost.toFixed(4)} |\n`;
      }
      md += '\n';
    }

    md += `## ❤️ Health\n\n`;
    for (const h of report.health) {
      md += `### ${h.serverName}\n\n`;
      md += `- Latency: ${h.latencyMs}ms\n`;
      md += `- Success rate: ${(h.successRate * 100).toFixed(0)}%\n`;
      md += `- Tools: ${h.toolCount}\n`;
      md += `- Context pressure: ${(h.contextPressure * 100).toFixed(0)}%\n`;
      if (h.overloadWarning) md += `⚠️ Tool overload warning (>15 tools)\n`;
      if (h.recommendations.length > 0) {
        for (const rec of h.recommendations) md += `- ${rec}\n`;
      }
      md += '\n';
    }

    return md;
  }
}