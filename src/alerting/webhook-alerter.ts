import { Logger } from '../utils/logger.js';

export type AlertSeverity = 'critical' | 'high' | 'warning' | 'info' | 'medium';

export interface AlertPayload {
  severity: 'critical' | 'high' | 'medium';
  title: string;
  message: string;
  server?: string;
  tool?: string;
  timestamp: string;
  requestId?: string;
}

/** Backward-compatible alert shape (src/alerts consumers) */
export interface Alert {
  title: string;
  message: string;
  severity: 'critical' | 'warning' | 'info';
  serverName?: string;
  metadata?: Record<string, string>;
}

export interface WebhookConfig {
  url: string;
  type: 'slack' | 'pagerduty' | 'discord' | 'generic';
  token?: string;
  minSeverity: 'critical' | 'high' | 'medium';
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  warning: 2,
  info: 1,
};

const WEBHOOK_MAX_RETRIES = 3;
const WEBHOOK_BASE_DELAY_MS = 200;
const webhookCircuitOpenUntil = new Map<string, number>();

function webhookBackoffMs(attempt: number): number {
  const jitter = Math.floor(Math.random() * 50);
  return WEBHOOK_BASE_DELAY_MS * 2 ** attempt + jitter;
}

export class WebhookAlerter {
  constructor(private configs: WebhookConfig[]) {}

  async alert(payload: AlertPayload): Promise<void> {
    const payloadRank = SEVERITY_RANK[payload.severity] ?? 0;

    const promises = this.configs
      .filter((cfg) => payloadRank >= (SEVERITY_RANK[cfg.minSeverity] ?? 0))
      .map((cfg) => this.deliver(cfg, payload));

    const results = await Promise.allSettled(promises);
    for (const r of results) {
      if (r.status === 'rejected') {
        Logger.warn(`Alert webhook delivery failed: ${r.reason}`);
      }
    }
  }

  /** Legacy src/alerts API */
  async send(alert: Alert): Promise<void> {
    await this.alert({
      severity: alert.severity === 'critical' ? 'critical' : alert.severity === 'warning' ? 'high' : 'medium',
      title: alert.title,
      message: alert.message,
      server: alert.serverName,
      timestamp: new Date().toISOString(),
    });
  }

  private async deliver(cfg: WebhookConfig, payload: AlertPayload): Promise<void> {
    let body: string;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (cfg.type === 'slack') {
      body = JSON.stringify({
        text: `*[MCP Guardian]* ${payload.severity.toUpperCase()}: ${payload.title}`,
        attachments: [{
          color: payload.severity === 'critical' ? 'danger' : 'warning',
          fields: [
            { title: 'Server', value: payload.server ?? 'unknown', short: true },
            { title: 'Tool', value: payload.tool ?? 'N/A', short: true },
            { title: 'Message', value: payload.message },
          ],
          footer: `MCP Guardian | ${payload.timestamp}`,
        }],
      });
    } else if (cfg.type === 'discord') {
      const colorMap: Record<string, number> = { critical: 0xff4455, high: 0xffd700, medium: 0x00d4ff };
      body = JSON.stringify({
        embeds: [{
          title: `MCP Guardian: ${payload.title}`,
          description: payload.message,
          color: colorMap[payload.severity] ?? 0x00d4ff,
          footer: { text: payload.server ? `Server: ${payload.server}` : 'MCP Guardian' },
          timestamp: payload.timestamp,
        }],
      });
    } else if (cfg.type === 'pagerduty') {
      body = JSON.stringify({
        routing_key: cfg.token,
        event_action: 'trigger',
        payload: {
          summary: `MCP Guardian: ${payload.title}`,
          severity: payload.severity === 'critical' ? 'critical' : 'warning',
          timestamp: payload.timestamp,
          custom_details: payload,
        },
      });
    } else {
      body = JSON.stringify(payload);
    }

    const openUntil = webhookCircuitOpenUntil.get(cfg.url) ?? 0;
    if (Date.now() < openUntil) {
      throw new Error('Webhook circuit open');
    }

    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < WEBHOOK_MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(cfg.url, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`Webhook returned ${res.status}`);
        webhookCircuitOpenUntil.delete(cfg.url);
        return;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (attempt < WEBHOOK_MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, webhookBackoffMs(attempt)));
        }
      }
    }

    webhookCircuitOpenUntil.set(cfg.url, Date.now() + 60_000);
    throw lastErr ?? new Error('Webhook delivery failed');
  }
}

function parseMinSeverity(): 'critical' | 'high' | 'medium' {
  const envSev = process.env['ALERT_MIN_SEVERITY'] || 'high';
  if (envSev === 'critical' || envSev === 'high' || envSev === 'medium') return envSev;
  if (envSev === 'warning' || envSev === 'info') return 'medium';
  Logger.warn(`[WebhookAlerter] Invalid ALERT_MIN_SEVERITY: ${envSev}, defaulting to 'high'`);
  return 'high';
}

function createAlerterFromEnv(): WebhookAlerter | null {
  const configs: WebhookConfig[] = [];
  const minSev = parseMinSeverity();

  if (process.env['ALERT_WEBHOOK_URL']) {
    const url = process.env['ALERT_WEBHOOK_URL'];
    const type = url.includes('discord') ? 'discord' : url.includes('slack') ? 'slack' : 'generic';
    configs.push({ url, type, minSeverity: minSev });
  }
  if (process.env['ALERT_SLACK_WEBHOOK']) {
    configs.push({ url: process.env['ALERT_SLACK_WEBHOOK'], type: 'slack', minSeverity: minSev });
  }
  if (process.env['ALERT_PAGERDUTY_KEY']) {
    configs.push({
      url: 'https://events.pagerduty.com/v2/enqueue',
      type: 'pagerduty',
      token: process.env['ALERT_PAGERDUTY_KEY'],
      minSeverity: minSev,
    });
  }
  if (process.env['ALERT_GENERIC_WEBHOOK']) {
    configs.push({ url: process.env['ALERT_GENERIC_WEBHOOK'], type: 'generic', minSeverity: minSev });
  }

  return configs.length > 0 ? new WebhookAlerter(configs) : null;
}

export const alerter = createAlerterFromEnv();

/**
 * Send an alert through configured webhooks (non-blocking).
 */
export async function sendAlert(alert: Alert): Promise<void> {
  if (!alerter) return;
  const minSev = process.env['ALERT_MIN_SEVERITY'] || 'warning';
  const rank: Record<string, number> = { critical: 3, warning: 2, info: 1 };
  if ((rank[alert.severity] ?? 0) < (rank[minSev] ?? 2)) return;

  try {
    await alerter.send(alert);
  } catch (err) {
    Logger.warn(`[alerter] Failed to send ${alert.severity} alert: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Fire alert for policy blocks (used by proxy) */
export async function alertPolicyBlock(
  serverName: string,
  toolName: string,
  rule: string,
  reason: string,
  requestId?: string,
): Promise<void> {
  if (!alerter) return;
  void alerter.alert({
    severity: 'high',
    title: 'Tool call blocked',
    message: reason,
    server: serverName,
    tool: toolName,
    timestamp: new Date().toISOString(),
    requestId,
  }).catch((err) => {
    Logger.warn(`[alerter] Policy block alert failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}
