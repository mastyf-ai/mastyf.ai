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
  const contentLines = ['BT', '/F1 10 Tf', '50 750 Td'];
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) contentLines.push('0 -14 Td');
    contentLines.push(`(${escapePdfText(lines[i]!.slice(0, 120))}) Tj`);
  }
  contentLines.push('ET');
  const stream = contentLines.join('\n');
  const streamLen = Buffer.byteLength(stream);

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${streamLen} >>\nstream\n${stream}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += obj;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf);
}

export function complianceEvidenceDir(): string {
  return process.env.GUARDIAN_COMPLIANCE_EVIDENCE_DIR || join(homedir(), '.mcp-guardian', 'compliance-evidence');
}

export async function writeComplianceEvidencePdf(bundle: ComplianceEvidenceBundle): Promise<string> {
  const dir = complianceEvidenceDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const stamp = bundle.generatedAt.replace(/[:.]/g, '-');
  const path = join(dir, `compliance-${bundle.framework}-${stamp}.pdf`);

  const lines = [
    'MCP Guardian Compliance Evidence',
    `Framework: ${bundle.framework}`,
    `Generated: ${bundle.generatedAt}`,
    `Policy: ${bundle.policyPath}`,
    `Posture score: ${bundle.posture.postureScore}%`,
    `Audit calls: ${bundle.auditCounts.totalCalls} blocked: ${bundle.auditCounts.blockedCalls}`,
    `Servers: ${bundle.auditCounts.servers.join(', ').slice(0, 80)}`,
    'Controls:',
    ...bundle.posture.controls.slice(0, 25).map(
      (c) => `  ${c.controlId} [${c.satisfied ? 'ok' : 'gap'}] ${c.controlName}`.slice(0, 120),
    ),
  ];

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
