import { Logger } from '../utils/logger.js';

export interface AlertPayload {
  severity:   'critical' | 'high' | 'medium';
  title:      string;
  message:    string;
  server?:    string;
  tool?:      string;
  timestamp:  string;
  requestId?: string;
}

export interface WebhookConfig {
  url:      string;
  type:     'slack' | 'pagerduty' | 'generic';
  token?:   string;
  minSeverity: 'critical' | 'high' | 'medium';
}

export class WebhookAlerter {
  constructor(private configs: WebhookConfig[]) {}

  async alert(payload: AlertPayload): Promise<void> {
    const severityRank: Record<string, number> = { critical: 3, high: 2, medium: 1 };

    const promises = this.configs
      .filter((cfg) => severityRank[payload.severity] >= (severityRank[cfg.minSeverity] ?? 0))
      .map((cfg) => this.send(cfg, payload));

    const results = await Promise.allSettled(promises);
    for (const r of results) {
      if (r.status === 'rejected') {
        Logger.warn(`Alert webhook delivery failed: ${r.reason}`);
      }
    }
  }

  private async send(cfg: WebhookConfig, payload: AlertPayload): Promise<void> {
    let body: string;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (cfg.type === 'slack') {
      body = JSON.stringify({
        text: `*[MCP Guardian]* ${payload.severity.toUpperCase()}: ${payload.title}`,
        attachments: [{
          color:  payload.severity === 'critical' ? 'danger' : 'warning',
          fields: [
            { title: 'Server',  value: payload.server  ?? 'unknown', short: true },
            { title: 'Tool',    value: payload.tool    ?? 'N/A',     short: true },
            { title: 'Message', value: payload.message },
          ],
          footer: `MCP Guardian | ${payload.timestamp}`,
        }],
      });
    } else if (cfg.type === 'pagerduty') {
      body = JSON.stringify({
        routing_key:  cfg.token,
        event_action: 'trigger',
        payload: {
          summary:   `MCP Guardian: ${payload.title}`,
          // Map to PagerDuty accepted severity values: critical, error, warning, info
          severity:  payload.severity === 'critical' ? 'critical' :
                     payload.severity === 'high' || payload.severity === 'medium' ? 'warning' : 'info',
          timestamp: payload.timestamp,
          custom_details: payload,
        },
      });
    } else {
      body = JSON.stringify(payload);
    }

    const res = await fetch(cfg.url, {
      method: 'POST', headers, body,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Webhook returned ${res.status}`);
  }
}

// Global singleton — configured via env vars
function createAlerterFromEnv(): WebhookAlerter | null {
  const configs: WebhookConfig[] = [];
  const validSeverities = ['critical', 'high', 'medium'] as const;
  const envSev = process.env['ALERT_MIN_SEVERITY'] || 'high';
  const minSev: 'critical' | 'high' | 'medium' =
    validSeverities.includes(envSev as any) ? (envSev as 'critical' | 'high' | 'medium') : 'high';
  if (!validSeverities.includes(envSev as any)) {
    Logger.warn(`[WebhookAlerter] Invalid ALERT_MIN_SEVERITY: ${envSev}, defaulting to 'high'`);
  }

  if (process.env['ALERT_SLACK_WEBHOOK']) {
    configs.push({ url: process.env['ALERT_SLACK_WEBHOOK'], type: 'slack', minSeverity: minSev });
  }
  if (process.env['ALERT_PAGERDUTY_KEY']) {
    configs.push({ url: 'https://events.pagerduty.com/v2/enqueue', type: 'pagerduty', token: process.env['ALERT_PAGERDUTY_KEY'], minSeverity: minSev });
  }
  if (process.env['ALERT_GENERIC_WEBHOOK']) {
    configs.push({ url: process.env['ALERT_GENERIC_WEBHOOK'], type: 'generic', minSeverity: minSev });
  }

  return configs.length > 0 ? new WebhookAlerter(configs) : null;
}

export const alerter = createAlerterFromEnv();