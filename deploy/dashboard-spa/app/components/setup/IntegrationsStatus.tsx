'use client';

import { useEffect, useState } from 'react';
import { mastyfAiFetch } from '@/lib/mastyf-ai-api';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';

type Status = {
  siem: {
    enabled: boolean;
    protocol: string | null;
    endpointConfigured: boolean;
    connectors: { splunk: boolean; elastic: boolean; otel: boolean; file: boolean };
  };
  alerts: { slack: boolean; pagerduty: boolean; generic: boolean };
};

function On({ on }: { on: boolean }) {
  return on ? <Badge variant="success" dot>On</Badge> : <Badge variant="neutral" dot>Off</Badge>;
}

const pre: React.CSSProperties = {
  background: 'var(--bg-muted)',
  padding: 10,
  borderRadius: 8,
  fontSize: 12,
  overflow: 'auto',
  margin: '8px 0 0',
};

/**
 * Webhook alerts and SIEM export are configured with environment variables read at start-up
 * (src/alerting/alert-env.ts, src/exporters/*). This shows which are on, from /api/integrations/status,
 * and the variables that turn each one on.
 */
export function IntegrationsStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void mastyfAiFetch('/api/integrations/status')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setStatus((await res.json()) as Status);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Request failed'));
  }, []);

  if (error) {
    return (
      <Card title="Alerts and SIEM export">
        <p className="text-sm text-muted">Could not read integration status: {error}</p>
      </Card>
    );
  }
  if (!status) {
    return (
      <Card title="Alerts and SIEM export">
        <p className="text-sm text-muted">Checking</p>
      </Card>
    );
  }

  const anyAlert = status.alerts.slack || status.alerts.pagerduty || status.alerts.generic;
  const c = status.siem.connectors;

  return (
    <>
      <Card title="Block alerts" subtitle="Sent when Mastyf blocks a tool call">
        <ul className="text-sm" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          <li>Slack or Discord webhook <On on={status.alerts.slack} /></li>
          <li>PagerDuty <On on={status.alerts.pagerduty} /></li>
          <li>Any other webhook (JSON POST) <On on={status.alerts.generic} /></li>
        </ul>
        {!anyAlert && (
          <>
            <p className="text-sm text-muted" style={{ marginTop: 10 }}>To turn alerts on, set one or more of these and restart Mastyf:</p>
            <pre style={pre}>{`ALERT_SLACK_WEBHOOK=https://hooks.slack.com/services/...
ALERT_PAGERDUTY_KEY=<Events API v2 routing key>
ALERT_GENERIC_WEBHOOK=https://your-service.example/mastyf`}</pre>
          </>
        )}
      </Card>

      <Card title="SIEM export" subtitle="Forward every decision to your SIEM">
        <ul className="text-sm" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          <li>
            Export <On on={status.siem.enabled} />
            {status.siem.enabled && status.siem.protocol && <> as <code>{status.siem.protocol}</code></>}
            {status.siem.enabled && !status.siem.endpointConfigured && <> (no endpoint set)</>}
          </li>
          <li>Splunk HEC <On on={c.splunk} /></li>
          <li>Elastic <On on={c.elastic} /></li>
          <li>OpenTelemetry <On on={c.otel} /></li>
          <li>File export <On on={c.file} /></li>
        </ul>
        {!status.siem.enabled && !c.splunk && !c.elastic && !c.otel && (
          <>
            <p className="text-sm text-muted" style={{ marginTop: 10 }}>For example, to send CEF over syslog:</p>
            <pre style={pre}>{`MASTYF_AI_SIEM_ENABLED=true
MASTYF_AI_SIEM_PROTOCOL=cef          # cef | syslog | splunk-hec
MASTYF_AI_SIEM_ENDPOINT=siem.example.internal:514`}</pre>
          </>
        )}
      </Card>
    </>
  );
}
