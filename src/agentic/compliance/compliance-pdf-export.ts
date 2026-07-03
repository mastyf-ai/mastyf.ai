/**
 * Export compliance evidence bundle as a simple PDF (text layout via minimal PDF writer).
 */
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ComplianceEvidenceBundle } from './compliance-evidence-runner.js';

function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildMinimalPdf(lines: string[]): Buffer {
  const linesPerPage = 48;
  const pages: string[][] = [];
  for (let i = 0; i < Math.max(lines.length, 1); i += linesPerPage) {
    pages.push(lines.slice(i, i + linesPerPage));
  }

  const objects = new Map<number, string>();
  const pageIds: number[] = [];
  let nextObjectId = 4;
  objects.set(1, '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.set(3, '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  for (const pageLines of pages) {
    const pageId = nextObjectId++;
    const contentId = nextObjectId++;
    pageIds.push(pageId);
    const contentLines = ['BT', '/F1 10 Tf', '50 750 Td'];
    for (let i = 0; i < pageLines.length; i++) {
      if (i > 0) contentLines.push('0 -14 Td');
      contentLines.push(`(${escapePdfText(pageLines[i]!.slice(0, 120))}) Tj`);
    }
    contentLines.push('ET');
    const stream = contentLines.join('\n');
    const streamLen = Buffer.byteLength(stream);
    objects.set(
      pageId,
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n`,
    );
    objects.set(contentId, `${contentId} 0 obj\n<< /Length ${streamLen} >>\nstream\n${stream}\nendstream\nendobj\n`);
  }

  objects.set(2, `2 0 obj\n<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>\nendobj\n`);

  let pdf = '%PDF-1.4\n';
  const maxObjectId = Math.max(...objects.keys());
  const offsets: number[] = new Array(maxObjectId + 1).fill(0);
  for (let id = 1; id <= maxObjectId; id++) {
    const obj = objects.get(id);
    if (!obj) continue;
    offsets[id] = Buffer.byteLength(pdf);
    pdf += obj;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${maxObjectId + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= maxObjectId; i++) {
    pdf += offsets[i] > 0 ? `${String(offsets[i]).padStart(10, '0')} 00000 n \n` : '0000000000 65535 f \n';
  }
  pdf += `trailer\n<< /Size ${maxObjectId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf);
}

export function complianceEvidenceDir(): string {
  return process.env.MASTYF_AI_COMPLIANCE_EVIDENCE_DIR || join(homedir(), '.mastyf-ai', 'compliance-evidence');
}

function pushWrapped(lines: string[], prefix: string, value: string, max = 112): void {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    lines.push(prefix);
    return;
  }
  let remaining = `${prefix}${normalized}`;
  while (remaining.length > max) {
    const breakAt = Math.max(remaining.lastIndexOf(' ', max), prefix.length + 20);
    lines.push(remaining.slice(0, breakAt));
    remaining = `${' '.repeat(Math.min(prefix.length, 8))}${remaining.slice(breakAt).trim()}`;
  }
  lines.push(remaining);
}

export async function writeComplianceEvidencePdf(bundle: ComplianceEvidenceBundle): Promise<string> {
  const dir = complianceEvidenceDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const stamp = bundle.generatedAt.replace(/[:.]/g, '-');
  const path = join(dir, `compliance-${bundle.framework}-${stamp}.pdf`);

  const lines: string[] = [
    'MCP Mastyf AI Compliance Evidence',
    `Framework: ${bundle.framework}`,
    `Generated: ${bundle.generatedAt}`,
    `Policy: ${bundle.policyPath}`,
    `Posture score: ${bundle.posture.postureScore}%`,
    `Audit calls: ${bundle.auditCounts.totalCalls} blocked: ${bundle.auditCounts.blockedCalls}`,
    `Servers: ${bundle.auditCounts.servers.join(', ').slice(0, 80)}`,
    `Posture summary: ${bundle.posture.summary}`,
    '',
    'Evidence Data Sources',
    '- Live proxy call_records from the configured history database',
    '- Current policy YAML loaded by the dashboard proxy',
    '- Compliance control mapper evaluation for this framework',
    '',
    'Policy Signals Used',
  ];

  for (const signal of bundle.policySignals.slice(0, 20)) {
    pushWrapped(
      lines,
      `- ${signal.enabled ? 'enabled' : 'disabled'} ${signal.action ?? 'action-unset'}: `,
      `${signal.name}${signal.description ? ` - ${signal.description}` : ''}`,
    );
  }
  if (bundle.policySignals.length === 0) lines.push('- No policy rules were readable from the configured policy path.');

  lines.push('', 'Audit Evidence By Server');
  for (const server of bundle.auditCounts.byServer.slice(0, 20)) {
    lines.push(`- ${server.serverName}: calls=${server.totalCalls} blocked=${server.blockedCalls}`);
  }
  if (bundle.auditCounts.byServer.length === 0) lines.push('- No proxy call records found for this tenant.');

  lines.push('', 'Security Scan Evidence');
  for (const scan of bundle.auditCounts.securityScans.slice(0, 20)) {
    lines.push(`- ${scan.serverName}: score=${scan.score} cves=${scan.cveCount}`);
    for (const recommendation of scan.recommendations.slice(0, 3)) {
      pushWrapped(lines, '  recommendation: ', recommendation);
    }
  }
  if (bundle.auditCounts.securityScans.length === 0) lines.push('- No security scan records found for active servers.');

  lines.push('', 'Recent Blocked Calls');
  for (const call of bundle.auditCounts.recentBlocked.slice(0, 12)) {
    pushWrapped(
      lines,
      `- ${call.timestamp} ${call.serverName}.${call.toolName}: `,
      `${call.blockRule ?? 'rule-unavailable'}${call.blockReason ? ` - ${call.blockReason}` : ''}${call.argumentSnippet ? ` args=${call.argumentSnippet}` : ''}`,
    );
  }
  if (bundle.auditCounts.recentBlocked.length === 0) lines.push('- No blocked calls were found in the current audit window.');

  lines.push('', 'Control Evidence Details');
  for (const control of bundle.posture.controls) {
    lines.push('');
    lines.push(`${control.controlId} [${control.satisfied ? 'ok' : 'gap'}] ${control.controlName}`);
    pushWrapped(lines, 'Description: ', control.description);
    if (control.satisfiedBy.length > 0) {
      pushWrapped(lines, 'Matched evidence: ', control.satisfiedBy.join(', '));
    } else {
      lines.push('Matched evidence: none found in current policy/audit signals');
    }
    if (control.gap) pushWrapped(lines, 'Gap: ', control.gap);
    if (control.recommendedPolicy) {
      lines.push('Recommended remediation policy:');
      for (const recommendationLine of control.recommendedPolicy.split('\n')) {
        pushWrapped(lines, '  ', recommendationLine);
      }
    }
  }

  writeFileSync(path, buildMinimalPdf(lines));
  return path;
}

/** Shared minimal PDF writer for compliance + insurance reports (C4). */
export function writePdfFromLines(lines: string[], outputPath: string): { path: string; pdfBase64: string } {
  const pdf = buildMinimalPdf(lines);
  const dir = outputPath.includes('/') ? outputPath.replace(/\/[^/]+$/, '') : '.';
  if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(outputPath, pdf);
  return { path: outputPath, pdfBase64: pdf.toString('base64') };
}
