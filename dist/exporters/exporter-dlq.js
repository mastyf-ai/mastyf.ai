/**
 * Dead-letter queue + retry for SIEM exporters (audit durability).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Logger } from '../utils/logger.js';
const DLQ_DIR = join(homedir(), '.mastyf-ai', 'exporter-dlq');
const DLQ_PATH = join(DLQ_DIR, 'pending.jsonl');
function ensureDlqDir() {
    if (!existsSync(DLQ_DIR))
        mkdirSync(DLQ_DIR, { recursive: true });
}
export function appendExporterDlq(entry) {
    if (process.env['MASTYF_AI_EXPORTER_DLQ'] === 'false')
        return;
    ensureDlqDir();
    appendFileSync(DLQ_PATH, `${JSON.stringify(entry)}\n`, 'utf-8');
}
export function loadExporterDlq(max = 500) {
    if (!existsSync(DLQ_PATH))
        return [];
    const lines = readFileSync(DLQ_PATH, 'utf-8').split('\n').filter(Boolean);
    const out = [];
    for (const line of lines.slice(-max)) {
        try {
            out.push(JSON.parse(line));
        }
        catch {
            /* skip */
        }
    }
    return out;
}
export function rewriteExporterDlq(remaining) {
    ensureDlqDir();
    if (!remaining.length) {
        writeFileSync(DLQ_PATH, '', 'utf-8');
        return;
    }
    writeFileSync(DLQ_PATH, remaining.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
}
export async function sendWithRetry(exporterName, sendFn, event) {
    const maxAttempts = parseInt(process.env['MASTYF_AI_EXPORTER_MAX_RETRIES'] || '3', 10) || 3;
    let lastErr = '';
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await sendFn();
            return;
        }
        catch (err) {
            lastErr = err instanceof Error ? err.message : String(err);
            const delay = Math.min(30_000, 500 * 2 ** (attempt - 1));
            if (attempt < maxAttempts) {
                await new Promise((r) => setTimeout(r, delay));
            }
        }
    }
    Logger.warn(`[ExporterManager] ${exporterName} failed after ${maxAttempts} attempts: ${lastErr}`);
    appendExporterDlq({
        exporter: exporterName,
        event,
        attempts: maxAttempts,
        lastError: lastErr,
        enqueuedAt: new Date().toISOString(),
    });
}
export async function flushExporterDlq(senders) {
    const pending = loadExporterDlq();
    if (!pending.length)
        return 0;
    const remaining = [];
    let flushed = 0;
    for (const item of pending) {
        const send = senders[item.exporter];
        if (!send) {
            remaining.push(item);
            continue;
        }
        try {
            await send(item.event);
            flushed++;
        }
        catch (err) {
            item.attempts += 1;
            item.lastError = err instanceof Error ? err.message : String(err);
            remaining.push(item);
        }
    }
    rewriteExporterDlq(remaining);
    if (flushed > 0) {
        Logger.info(`[ExporterManager] Flushed ${flushed} DLQ event(s)`);
    }
    return flushed;
}
//# sourceMappingURL=exporter-dlq.js.map