/**
 * Insurance risk underwriter PDF export (C4) — uses compliance-pdf-export writer per plan.
 */
import { join } from 'path';
import { homedir } from 'os';
import type { InsuranceRiskReport } from '../insurance/risk-quantifier.js';
import { writePdfFromLines } from '../compliance/compliance-pdf-export.js';

export function insuranceReportDir(): string {
  return process.env.GUARDIAN_INSURANCE_REPORT_DIR || join(homedir(), '.mcp-guardian', 'insurance-reports');
}

export function writeInsuranceRiskPdf(report: InsuranceRiskReport): { path: string; pdfBase64: string } {
  const lines = [
    'MCP Guardian — Cyber Insurance Risk Report',
    `Server: ${report.serverName}`,
    `Generated: ${report.generatedAt}`,
    `Risk tier: ${report.riskTier.toUpperCase()}`,
    `ALE (USD): $${report.aleUsd.toLocaleString()}`,
    `Blast radius (USD): $${Math.round(report.blastRadiusUsd).toLocaleString()}`,
    `Exploit probability: ${(report.exploitProbability * 100).toFixed(1)}%`,
    `Exposure score: ${(report.exposureScore * 100).toFixed(0)}%`,
    '',
    report.underwriterSummary,
  ];
  const path = join(insuranceReportDir(), `insurance-${report.serverName}-${report.id.slice(0, 8)}.pdf`);
  return writePdfFromLines(lines, path);
}
