#!/usr/bin/env node
/**
 * SIEM export — reads mastyf audit JSONL files and exports as CEF (ArcSight),
 * LEEF (QRadar), or raw JSONL with SIEM-compatible timestamps.
 *
 * Usage:
 *   pnpm enterprise:siem --format cef --output /var/log/mastyf-cef.log
 *   node scripts/siem-export.mjs --format leef
 *   MASTYF_AI_SIEM_EXPORT_FORMAT=jsonl node scripts/siem-export.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

const format = process.env['MASTYF_AI_SIEM_EXPORT_FORMAT'] || flag('--format') || 'jsonl';
const output = flag('--output');
const windowHours = parseInt(flag('--window') || process.env['MASTYF_AI_SIEM_EXPORT_WINDOW_HOURS'] || '24', 10);
const tenantId = process.env['MASTYF_AI_TENANT_ID'] || 'default';

function auditDir(): string {
  return join(homedir(), '.mastyf-ai', 'tenants', tenantId);
}

function loadEntries(): unknown[] {
  const dir = auditDir();
  if (!existsSync(dir)) return [];
  const entries: unknown[] = [];
  const since = windowHours ? Date.now() - windowHours * 3600_000 : 0;
  try {
    const { readdirSync } = await import('fs');
  } catch {}
  // Read policy-audit.jsonl
  const policyPath = join(dir, 'policy-audit.jsonl');
  if (existsSync(policyPath)) {
    const lines = readFileSync(policyPath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (since && new Date(entry.timestamp).getTime() < since) continue;
        entries.push(entry);
      } catch { /* skip malformed lines */ }
    }
  }
  // Also read dashboard-access.jsonl
  const accessPath = join(dir, 'dashboard-access.jsonl');
  if (existsSync(accessPath)) {
    const lines = readFileSync(accessPath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (since && new Date(entry.timestamp).getTime() < since) continue;
        entries.push({ ...entry, _source: 'dashboard-access' });
      } catch { /* skip */ }
    }
  }
  return entries;
}

function cefTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
}

function toCef(entry: Record<string, unknown>): string {
  const name = String(entry['action'] || entry['event'] || 'audit');
  const severity = entry['severity'] ? String(entry['severity']) : '5';
  const msg = String(entry['reason'] || entry['message'] || entry['details'] || '');
  const sigId = createHash('sha256').update(JSON.stringify(entry)).digest('hex').slice(0, 8);

  let ext = '';
  if (entry['serverName']) ext += ` dhost=${entry['serverName']}`;
  if (entry['toolName']) ext += ` cs2Label=tool cs2=${entry['toolName']}`;
  if (entry['rule']) ext += ` cs1Label=rule cs1=${entry['rule']}`;
  if (entry['phase']) ext += ` cs3Label=phase cs3=${entry['phase']}`;
  if (entry['ipAddress'] || entry['ip']) ext += ` src=${entry['ipAddress'] || entry['ip']}`;
  if (entry['username'] || entry['identity']) ext += ` suser=${entry['username'] || entry['identity']}`;
  if (entry['tenantId']) ext += ` cs4Label=tenant cs4=${entry['tenantId']}`;

  return `CEF:0|mastyf.ai|MCP Proxy|4.2.0|${name}|${msg}|${severity}|msg=${msg}${ext}`;
}

function leefTimestamp(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ') + 'Z';
}

function toLeef(entry: Record<string, unknown>): string {
  const name = String(entry['action'] || entry['event'] || 'audit');
  const msg = String(entry['reason'] || entry['message'] || entry['details'] || '');
  const severity = entry['severity'] ? String(entry['severity']) : '5';

  let attrs = `devTime=${leefTimestamp(String(entry['timestamp'] || new Date().toISOString()))}`;
  if (entry['serverName']) attrs += `\tdvc=${entry['serverName']}`;
  if (entry['toolName']) attrs += `\tcs2=${entry['toolName']}`;
  if (entry['rule']) attrs += `\tcs1=${entry['rule']}`;
  if (entry['ipAddress'] || entry['ip']) attrs += `\tsrc=${entry['ipAddress'] || entry['ip']}`;
  if (entry['username'] || entry['identity']) attrs += `\tusrName=${entry['username'] || entry['identity']}`;
  if (entry['tenantId']) attrs += `\tcs4=${entry['tenantId']}`;

  return `LEEF:2.0|mastyf.ai|MCP Proxy|4.2.0|${name}|\t${attrs}\tsev=${severity}\tmsg=${msg}`;
}

async function main() {
  const entries = loadEntries();
  console.error(`[siem-export] Loaded ${entries.length} entries (window: ${windowHours}h, tenant: ${tenantId})`);

  let output_content = '';
  for (const entry of entries) {
    const e = entry as Record<string, unknown>;
    switch (format) {
      case 'cef':
        output_content += toCef(e) + '\n';
        break;
      case 'leef':
        output_content += toLeef(e) + '\n';
        break;
      case 'jsonl':
      default:
        output_content += JSON.stringify({
          ...e,
          _exported_at: new Date().toISOString(),
          _format: 'jsonl',
        }) + '\n';
        break;
    }
  }

  if (output) {
    const outDir = dirname(output);
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    writeFileSync(output, output_content, 'utf-8');
    console.error(`[siem-export] Written ${entries.length} entries to ${output}`);
  } else {
    process.stdout.write(output_content);
  }
}

main().catch((err) => {
  console.error('[siem-export] Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
