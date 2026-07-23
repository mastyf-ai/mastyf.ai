import { getPersistenceStore } from './persistence-store.js';
import { Logger } from './logger.js';

let alertTimer: ReturnType<typeof setInterval> | null = null;

export function startAlertManager(): void {
  const threshold = parseFloat(process.env.MASTYF_AI_ALERT_BLOCK_RATE_THRESHOLD || '50');
  const webhookUrl = process.env.MASTYF_AI_ALERT_WEBHOOK_URL || process.env.ALERT_SLACK_WEBHOOK || process.env.ALERT_WEBHOOK_URL;
  const intervalMs = parseInt(process.env.MASTYF_AI_ALERT_INTERVAL_MS || '60000', 10);

  if (!webhookUrl) {
    Logger.info('[alert-manager] No webhook configured — alerting disabled');
    return;
  }

  let lastBlockCount = 0;
  alertTimer = setInterval(async () => {
    try {
      const store = getPersistenceStore();
      const rows = store.getUserPolicies('default');
      const policies = rows.length;
      const hooks = 0; // Will be populated by the hook registry count

      // Check block rate from audit chain
      const chainResult = store.verifyAuditChain ? store.verifyAuditChain() : { entries: 0 };
      const currentBlockCount = (chainResult as any).entries || 0;
      const newBlocks = currentBlockCount - lastBlockCount;
      lastBlockCount = currentBlockCount;

      if (newBlocks > threshold) {
        const payload = {
          text: `:warning: Mastyf AI — High block rate: ${newBlocks} blocks in the last ${intervalMs/1000}s (threshold: ${threshold})`,
        };
        await fetch(webhookUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload), signal: AbortSignal.timeout(5000),
        });
        Logger.warn(`[alert-manager] Block rate spike: ${newBlocks} blocks`);
      }
    } catch {}
  }, intervalMs);

  Logger.info(`[alert-manager] Started (threshold=${threshold}/min, webhook configured)`);
}

export function stopAlertManager(): void {
  if (alertTimer) { clearInterval(alertTimer); alertTimer = null; }
}
