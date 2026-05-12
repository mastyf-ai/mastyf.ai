import https from 'https';
import { Logger } from '../utils/logger.js';

// ═══════════════════════════════════════════════════════════════
// GAP 18: Slack/Discord Webhook Alerter
// Uses webhook URL from env: ALERT_WEBHOOK_URL
// ═══════════════════════════════════════════════════════════════

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface Alert {
  title: string;
  message: string;
  severity: AlertSeverity;
  serverName?: string;
  metadata?: Record<string, string>;
}

export class WebhookAlerter {
  private webhookUrl: string;
  private platform: 'slack' | 'discord' | 'generic';

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
    this.platform = webhookUrl.includes('discord')
      ? 'discord'
      : webhookUrl.includes('slack')
      ? 'slack'
      : 'generic';
  }

  async send(alert: Alert): Promise<void> {
    const body = this.platform === 'discord'
      ? this.buildDiscordPayload(alert)
      : this.buildSlackPayload(alert);

    await this.post(body);
  }

  private buildSlackPayload(alert: Alert): Record<string, unknown> {
    const colorMap: Record<AlertSeverity, string> = { critical: '#ff4455', warning: '#ffd700', info: '#00d4ff' };
    return {
      attachments: [{
        color:  colorMap[alert.severity],
        title:  `🛡️ MCP Guardian: ${alert.title}`,
        text:   alert.message,
        footer: alert.serverName ? `Server: ${alert.serverName}` : undefined,
        ts:     Math.floor(Date.now() / 1000),
      }],
    };
  }

  private buildDiscordPayload(alert: Alert): Record<string, unknown> {
    const colorMap: Record<AlertSeverity, number> = { critical: 0xff4455, warning: 0xffd700, info: 0x00d4ff };
    return {
      embeds: [{
        title:       `🛡️ MCP Guardian: ${alert.title}`,
        description: alert.message,
        color:       colorMap[alert.severity],
        footer:      { text: alert.serverName ? `Server: ${alert.serverName}` : 'MCP Guardian' },
        timestamp:   new Date().toISOString(),
      }],
    };
  }

  private post(body: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const url = new URL(this.webhookUrl);
      const req = https.request(
        {
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          if ((res.statusCode ?? 0) >= 400) {
            reject(new Error(`Webhook returned ${res.statusCode}`));
          } else {
            resolve();
          }
        }
      );
      req.on('error', reject);
      req.setTimeout(10_000, () => {
        req.destroy();
        reject(new Error('Webhook request timed out'));
      });
      req.write(payload);
      req.end();
    });
  }
}

// Global singleton — initialised if ALERT_WEBHOOK_URL is set
export const alerter: WebhookAlerter | null = process.env['ALERT_WEBHOOK_URL']
  ? new WebhookAlerter(process.env['ALERT_WEBHOOK_URL'])
  : null;

/**
 * Send an alert through the configured webhook (if any).
 * Non-blocking — failures are logged but never thrown.
 */
export async function sendAlert(alert: Alert): Promise<void> {
  if (!alerter) return;
  const minSeverity = process.env['ALERT_MIN_SEVERITY'] || 'warning';
  const severityRank: Record<AlertSeverity, number> = { critical: 3, warning: 2, info: 1 };
  if (severityRank[alert.severity] < (severityRank[minSeverity as AlertSeverity] ?? 1)) return;

  try {
    await alerter.send(alert);
  } catch (err: any) {
    Logger.warn(`[alerter] Failed to send ${alert.severity} alert: ${err?.message}`);
  }
}